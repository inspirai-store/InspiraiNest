// One exit path for native account bridges: abort login, remove the local
// authorization, then publish the new session to renderer cache owners.
export function logoutOwnerSession({ owner, cancelLogin, publish }) {
  cancelLogin();
  const connection = owner.logout();
  publish(connection);
  return connection;
}

export async function pairOwnerSession({ input, owner, manager, controller, current, publish }) {
  const result = await manager.pair(input, {
    clientType: 'desktop', signal: controller.signal, current,
    onPaired: ({ server, installationId, result }) => owner.saveCredential({
      server, installationId, deviceId: result.device.id, token: result.ownerToken,
    }, { allowServerChange: true }),
  });
  publish(owner.status());
  return result;
}
