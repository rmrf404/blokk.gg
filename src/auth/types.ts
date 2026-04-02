import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      xId: string;
      xHandle: string;
      xAvatar: string;
      displayName: string;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    xId?: string;
    xHandle?: string;
    xAvatar?: string;
    displayName?: string;
  }
}
