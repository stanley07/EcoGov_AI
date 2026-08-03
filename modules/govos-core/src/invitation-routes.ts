export const INVITATION_ACCEPTANCE_HASH_ROUTE = "#/accept-invitation";

export function buildInvitationActivationUrl(
  webOrigin: string,
  invitationToken: string,
): string {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(invitationToken)) {
    throw new Error("Invitation token format is invalid");
  }
  const url = new URL(webOrigin);
  url.pathname = "/";
  url.search = "";
  url.hash = `${INVITATION_ACCEPTANCE_HASH_ROUTE.slice(1)}?${new URLSearchParams({ token: invitationToken })}`;
  return url.toString();
}
