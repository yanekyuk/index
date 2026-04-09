use dashmap::DashMap;
use std::time::{Duration, Instant};

const TTL: Duration = Duration::from_secs(300); // 5 minutes

pub struct SeenSet(DashMap<String, Instant>);

impl SeenSet {
    pub fn new() -> Self {
        Self(DashMap::new())
    }

    /// Returns true if this signature was seen within TTL.
    /// Inserts the entry on first occurrence; does not refresh TTL on duplicate.
    pub fn check_and_insert(&self, sig: &str) -> bool {
        let now = Instant::now();
        if let Some(entry) = self.0.get(sig) {
            if now.duration_since(*entry) < TTL {
                return true; // duplicate within TTL
            }
        }
        self.0.insert(sig.to_string(), now);
        false
    }
}

impl Default for SeenSet {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_signature_not_duplicate() {
        let set = SeenSet::new();
        assert!(!set.check_and_insert("sig-abc"));
    }

    #[test]
    fn same_signature_is_duplicate() {
        let set = SeenSet::new();
        set.check_and_insert("sig-abc");
        assert!(set.check_and_insert("sig-abc"));
    }

    #[test]
    fn different_signatures_not_duplicate() {
        let set = SeenSet::new();
        set.check_and_insert("sig-abc");
        assert!(!set.check_and_insert("sig-xyz"));
    }
}
