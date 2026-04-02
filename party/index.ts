/**
 * Cloudflare Worker entry point for PartyServer.
 * Routes incoming requests to the correct Durable Object (Matchmaker or Gameroom).
 */

import { routePartykitRequest } from "partyserver";

export { Matchmaker } from "./matchmaker";
export { Gameroom } from "./gameroom";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env)) ||
      new Response("Not Found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
