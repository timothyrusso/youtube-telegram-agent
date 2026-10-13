// Publishes the agent as an MCP server so the Claude and ChatGPT apps can send it links and text.
// WorkOS AuthKit runs the sign-in; this file only verifies its tokens. Anyone can create an AuthKit
// account, so a valid token is not enough: its subject must be in MCP_ALLOWED_SUBJECTS.
import {
  extractBearerToken,
  ForbiddenError,
  localDev,
  oauthResource,
  verifyOidc,
  withAuthChallenges,
  type AuthFn,
} from 'eve/channels/auth';
import { mcpChannel } from 'eve/channels/mcp';

const issuer = process.env.MCP_AUTH_ISSUER ?? 'https://cultured-horizon-35-staging.authkit.app';
const resource = process.env.MCP_RESOURCE ?? 'https://youtube-telegram-agent.vercel.app/eve/v1/mcp';

const allowedSubjects = () =>
  (process.env.MCP_ALLOWED_SUBJECTS ?? '').split(',').map((subject) => subject.trim()).filter(Boolean);

const authKitUser: AuthFn<Request> = withAuthChallenges(
  async (request) => {
    const header = request.headers.get('authorization');
    if (!header) return null;
    const result = await verifyOidc(extractBearerToken(header), { issuer, audiences: [resource] });
    if (!result.ok) return null;
    const subject = result.sessionAuth.principalId;
    // Fails closed: with no allowlist configured nobody gets in. The subject is logged so the
    // owner can find theirs after the first sign-in; it is an id, not a secret.
    if (!allowedSubjects().includes(subject)) {
      console.warn('MCP sign-in from a subject that is not allowed', { subject });
      throw new ForbiddenError({ message: 'This account is not allowed to use this agent.' });
    }
    return { ...result.sessionAuth, principalType: 'user' };
  },
  [{ scheme: 'Bearer' }],
);

export default mcpChannel({
  auth: oauthResource([authKitUser, localDev()], { issuer, resource, scopes: ['openid', 'profile', 'email'] }),
});
