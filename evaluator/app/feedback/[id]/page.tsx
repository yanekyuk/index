"use client";

import { useParams } from "next/navigation";
import { EvaluatorShell } from "@/components/EvaluatorShell";
import { FeedbackView } from "@/components/FeedbackView";

export default function FeedbackDetailPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <EvaluatorShell>
      <FeedbackView selectedId={id} />
    </EvaluatorShell>
  );
}
