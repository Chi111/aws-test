import { createHmac, scryptSync, timingSafeEqual, randomBytes } from "node:crypto";

export type Role = "admin" | "operator" | "viewer";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

const writeRoles = new Set<Role>(["admin", "operator"]);

export function canWrite(role: Role) {
  return writeRoles.has(role);
}

export function canRead(role: Role) {
  return role === "admin" || role === "operator" || role === "viewer";
}

export async function createPasswordHash(password: string, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) {
    return false;
  }
  const candidate = Buffer.from(scryptSync(password, salt, 64).toString("hex"), "hex");
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export async function signSession(user: SessionUser, secret: string) {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 8;
  const header = base64UrlJson({ alg: "HS256", typ: "JWT" });
  const payload = base64UrlJson({ sub: user.id, email: user.email, name: user.name, role: user.role, exp });
  const signature = signPart(`${header}.${payload}`, secret);
  return `${header}.${payload}.${signature}`;
}

export async function verifySession(token: string, secret: string): Promise<SessionUser | null> {
  try {
    const [header, payloadPart, signature] = token.split(".");
    if (!header || !payloadPart || !signature) {
      return null;
    }
    const expected = signPart(`${header}.${payloadPart}`, secret);
    if (!safeEqual(signature, expected)) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    if (
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.name !== "string" ||
      (payload.role !== "admin" && payload.role !== "operator" && payload.role !== "viewer")
    ) {
      return null;
    }
    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role
    };
  } catch {
    return null;
  }
}

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signPart(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
