use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use std::sync::Arc;

use crate::AppState;
use crate::verify::verify_signature;
use crate::prompt::{WebhookEvent, is_relevant, build_prompt};

pub async fn handle(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    // 1. Extract and verify signature
    let sig = match headers.get("x-index-signature").and_then(|v| v.to_str().ok()) {
        Some(s) => s.to_string(),
        None => return StatusCode::UNAUTHORIZED,
    };

    if !verify_signature(&state.secret, &body, &sig) {
        return StatusCode::UNAUTHORIZED;
    }

    // 2. Dedup check
    if state.seen.check_and_insert(&sig) {
        tracing::info!("duplicate delivery, skipping");
        return StatusCode::OK;
    }

    // 3. Parse JSON
    let event: WebhookEvent = match serde_json::from_slice(&body) {
        Ok(e) => e,
        Err(err) => {
            tracing::warn!("failed to parse webhook body: {err}");
            return StatusCode::BAD_REQUEST;
        }
    };

    // 4. Filter
    if !is_relevant(&event) {
        tracing::info!("ignoring event: {}", event.event);
        return StatusCode::OK;
    }

    // 5. Build prompt and spawn openclaw
    let prompt = build_prompt(&event);
    tracing::info!("forwarding event {} to openclaw", event.event);

    tokio::spawn(async move {
        match tokio::process::Command::new("openclaw")
            .args(["agent", "--message", &prompt])
            .spawn()
        {
            Ok(mut child) => {
                tracing::info!("openclaw agent spawned");
                let _ = child.wait().await;
            }
            Err(err) => tracing::error!("failed to spawn openclaw agent: {err}"),
        }
    });

    StatusCode::OK
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::routing::post;
    use axum::Router;
    use axum_test::TestServer;
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    use serde_json::json;

    use crate::dedup::SeenSet;

    type HmacSha256 = Hmac<Sha256>;

    fn make_server(secret: &str) -> TestServer {
        let state = Arc::new(AppState {
            secret: secret.to_string(),
            seen: SeenSet::new(),
        });
        let app = Router::new()
            .route("/index/webhook", post(handle))
            .with_state(state)
            .into_make_service();
        TestServer::new(app).unwrap()
    }

    fn sign(secret: &str, body: &[u8]) -> String {
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(body);
        format!("sha256={}", hex::encode(mac.finalize().into_bytes()))
    }

    #[tokio::test]
    async fn valid_relevant_event_returns_200() {
        let server = make_server("testsecret");
        let body = json!({
            "event": "negotiation.turn_received",
            "timestamp": "2026-04-10T12:00:00.000Z",
            "payload": { "negotiation_id": "neg-abc" }
        });
        let body_bytes = serde_json::to_vec(&body).unwrap();
        let sig = sign("testsecret", &body_bytes);

        let resp = server
            .post("/index/webhook")
            .add_header("x-index-signature", sig)
            .bytes(body_bytes.into())
            .await;

        assert_eq!(resp.status_code(), 200);
    }

    #[tokio::test]
    async fn wrong_signature_returns_401() {
        let server = make_server("testsecret");
        let body = b"{\"event\":\"negotiation.turn_received\",\"timestamp\":\"t\",\"payload\":{}}";
        let resp = server
            .post("/index/webhook")
            .add_header("x-index-signature", "sha256=deadbeef")
            .bytes(body.as_ref().into())
            .await;

        assert_eq!(resp.status_code(), 401);
    }

    #[tokio::test]
    async fn irrelevant_event_returns_200_without_spawn() {
        let server = make_server("testsecret");
        let body = json!({
            "event": "opportunity.created",
            "timestamp": "2026-04-10T12:00:00.000Z",
            "payload": {}
        });
        let body_bytes = serde_json::to_vec(&body).unwrap();
        let sig = sign("testsecret", &body_bytes);

        let resp = server
            .post("/index/webhook")
            .add_header("x-index-signature", sig)
            .bytes(body_bytes.into())
            .await;

        assert_eq!(resp.status_code(), 200);
    }

    #[tokio::test]
    async fn duplicate_event_returns_200_immediately() {
        let secret = "testsecret";
        let state = Arc::new(AppState {
            secret: secret.to_string(),
            seen: SeenSet::new(),
        });
        let app = Router::new()
            .route("/index/webhook", post(handle))
            .with_state(state)
            .into_make_service();
        let server = TestServer::new(app).unwrap();

        let body = json!({
            "event": "negotiation.turn_received",
            "timestamp": "2026-04-10T12:00:00.000Z",
            "payload": { "negotiation_id": "neg-abc" }
        });
        let body_bytes = serde_json::to_vec(&body).unwrap();
        let sig = sign(secret, &body_bytes);

        // First delivery
        server
            .post("/index/webhook")
            .add_header("x-index-signature", sig.clone())
            .bytes(body_bytes.clone().into())
            .await;

        // Duplicate delivery
        let resp = server
            .post("/index/webhook")
            .add_header("x-index-signature", sig)
            .bytes(body_bytes.into())
            .await;

        assert_eq!(resp.status_code(), 200);
    }
}
