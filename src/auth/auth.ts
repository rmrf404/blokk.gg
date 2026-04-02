import NextAuth from "next-auth";
import Twitter from "next-auth/providers/twitter";
import "./types";

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const authSecret =
  readEnv("AUTH_SECRET") ??
  readEnv("NEXTAUTH_SECRET") ??
  "local-auth-secret-change-me";

const providers = [];
const twitterId = readEnv("AUTH_TWITTER_ID");
const twitterSecret = readEnv("AUTH_TWITTER_SECRET");
if (twitterId && twitterSecret) {
  providers.push(
    Twitter({
      clientId: twitterId,
      clientSecret: twitterSecret,
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: authSecret,
  trustHost: true,
  providers,
  callbacks: {
    async jwt({ token, profile }) {
      if (profile) {
        const p = profile as Record<string, unknown>;
        const data = (p.data ?? p) as Record<string, unknown>;
        token.xId = data.id as string;
        token.xHandle = data.username as string;
        token.xAvatar = data.profile_image_url as string;
        token.displayName = data.name as string;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.xId = token.xId as string;
        session.user.xHandle = token.xHandle as string;
        session.user.xAvatar = token.xAvatar as string;
        session.user.displayName = token.displayName as string;
      }
      return session;
    },
  },
});
