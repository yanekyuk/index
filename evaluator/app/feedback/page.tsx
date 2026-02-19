"use client";

import { EvaluatorShell } from "@/components/EvaluatorShell";
import { FeedbackView } from "@/components/FeedbackView";

export default function FeedbackPage() {
  return (
    <EvaluatorShell>
      <FeedbackView />
    </EvaluatorShell>
  );
}
