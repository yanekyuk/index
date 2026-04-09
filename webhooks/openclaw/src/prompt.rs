use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
pub struct WebhookEvent {
    pub event: String,
    pub timestamp: String,
    pub payload: Value,
}

/// Events we forward to OpenClaw. All others are ignored.
pub const RELEVANT_EVENTS: &[&str] = &[
    "negotiation.started",
    "negotiation.turn_received",
    "negotiation.completed",
];

pub fn is_relevant(event: &WebhookEvent) -> bool {
    RELEVANT_EVENTS.contains(&event.event.as_str())
}

/// Build the structured prompt string passed to `openclaw agent --message`.
pub fn build_prompt(event: &WebhookEvent) -> String {
    let mut lines = vec![
        "Index Network event received.".to_string(),
        String::new(),
        format!("Event: {}", event.event),
        format!("Timestamp: {}", event.timestamp),
    ];

    if let Some(id) = event.payload.get("negotiation_id").and_then(Value::as_str) {
        lines.push(format!("Negotiation ID: {id}"));
    }
    if let Some(msg) = event.payload.get("message").and_then(Value::as_str) {
        lines.push(format!("Message: {msg}"));
    }
    if let Some(opp) = event.payload.get("opportunity_id").and_then(Value::as_str) {
        lines.push(format!("Opportunity ID: {opp}"));
    }

    lines.push(String::new());
    lines.push(
        "You have the Index MCP tools available. Review the negotiation state and take the appropriate next action.".to_string(),
    );

    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn make_event(event_name: &str, payload: Value) -> WebhookEvent {
        WebhookEvent {
            event: event_name.to_string(),
            timestamp: "2026-04-10T12:00:00.000Z".to_string(),
            payload,
        }
    }

    #[test]
    fn negotiation_turn_is_relevant() {
        let e = make_event("negotiation.turn_received", json!({}));
        assert!(is_relevant(&e));
    }

    #[test]
    fn opportunity_created_is_not_relevant() {
        let e = make_event("opportunity.created", json!({}));
        assert!(!is_relevant(&e));
    }

    #[test]
    fn prompt_contains_event_and_negotiation_id() {
        let e = make_event(
            "negotiation.turn_received",
            json!({ "negotiation_id": "neg-123", "message": "Let's connect" }),
        );
        let prompt = build_prompt(&e);
        assert!(prompt.contains("negotiation.turn_received"));
        assert!(prompt.contains("neg-123"));
        assert!(prompt.contains("Let's connect"));
    }

    #[test]
    fn prompt_handles_missing_optional_fields() {
        let e = make_event("negotiation.started", json!({}));
        let prompt = build_prompt(&e);
        assert!(prompt.contains("negotiation.started"));
        assert!(!prompt.contains("null"));
    }
}
