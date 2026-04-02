"use client";

function isLocalDevHost(hostname: string) {
  const isPrivateIpv4 = /^(10\.\d+|127\.\d+|192\.168\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+)\.\d+$/.test(hostname);
  return hostname === "localhost"
    || isPrivateIpv4
    || hostname === "[::1]"
    || hostname.endsWith(".local");
}

function getConfiguredPartyServerHost() {
  if (process.env.NEXT_PUBLIC_PARTYSERVER_HOST) {
    return process.env.NEXT_PUBLIC_PARTYSERVER_HOST;
  }

  if (typeof window !== "undefined") {
    const { hostname, host, port } = window.location;
    const isNonStandardPort = port !== "" && port !== "80" && port !== "443";
    return isLocalDevHost(hostname) || isNonStandardPort ? `${hostname}:8787` : host;
  }

  return "localhost:8787";
}

export function getPartyServerUrl(path: string) {
  const host = getConfiguredPartyServerHost();
  const protocol = typeof window !== "undefined" && window.location.protocol === "https:"
    ? "wss"
    : "ws";
  return `${protocol}://${host}${path}`;
}
