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

  const tags = type === "waitlist" ? ["waitlist"] : ["newsletter"];
  
  const metadata: Record<string, string> = {};
  if (name) metadata.name = name;
  if (whatYouDo) metadata.what_you_do = whatYouDo;
  if (whoToMeet) metadata.who_to_meet = whoToMeet;

  const res = await fetch("https://api.buttondown.com/v1/subscribers", {
    method: "POST",
    headers: {
      Authorization: `Token ${process.env.BUTTONDOWN_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email_address: email,
      tags,
      metadata,
    }),
  });

  console.log(res);
  if (!res.ok) {
    return NextResponse.json(
      { error: "Subscription failed" },
      { status: res.status }
    );
  }

  return NextResponse.json({ success: true });
}
