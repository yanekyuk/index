import { NextRequest, NextResponse } from "next/server";

type SubscribeBody = {
  email: string;
  type: "newsletter" | "waitlist";
  name?: string;
  whatYouDo?: string;
  whoToMeet?: string;
};

export async function POST(request: NextRequest) {
  const body: SubscribeBody = await request.json();
  const { email, type = "newsletter", name, whatYouDo, whoToMeet } = body;

  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const res = await fetch(
    "https://app.loops.so/api/newsletter-form/cmkq2slhq0aii0iuf7jigfxos",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        source: type,
        firstName: name,
        whatYouDo,
        whoToMeet,
      }),
    }
  );
  if (!res.ok) {
    return NextResponse.json(
      { error: "Subscription failed" },
      { status: res.status }
    );
  }

  return NextResponse.json({ success: true });
}
