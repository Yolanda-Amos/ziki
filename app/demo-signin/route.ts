import { NextResponse, type NextRequest } from "next/server";
import { signIn } from "@/auth";
import { safeCallbackUrl } from "@/lib/safe-callback-url";

/**
 * Demo deployments only (DEMO_AUTO_SIGNIN=1): signs the visitor in as the
 * fixtures' Demo Owner through the normal password check, so a reviewer lands
 * straight on the issue list with no login screen. Off everywhere else.
 */
export async function GET(request: NextRequest) {
  const requested = safeCallbackUrl(request.nextUrl.searchParams.get("callbackUrl"), "/demo/issues/all");
  // The demo owner's home is the Demo workspace's issue list.
  const callbackUrl = requested === "/home" || requested === "/" ? "/demo/issues/all" : requested;
  if (process.env.DEMO_AUTO_SIGNIN !== "1") {
    return NextResponse.redirect(new URL(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`, request.nextUrl.origin));
  }
  await signIn("credentials", {
    email: "demo@fixtures.local",
    password: "ziki-demo-password",
    redirect: false,
  });
  return NextResponse.redirect(new URL(callbackUrl, request.nextUrl.origin));
}
