test('authenticated proprietor session survives a full-page sidebar navigation landing on a different serverless instance', async () => {
  const loginInstance = createAuthService();
  const loginServer = createServer(createApp({ auth: loginInstance }));
  await new Promise((resolve) => loginServer.listen(0, resolve));
  let token;
  try {
    token = loginInstance.login({ username: 'proprietor@osaah.edu.gh', password: 'Proprietor123!', portal: 'school' }).token;
  } finally { await new Promise((resolve) => loginServer.close(resolve)); }

  const navigationInstance = createAuthService();
  const navigationServer = createServer(createApp({ auth: navigationInstance }));
  await new Promise((resolve) => navigationServer.listen(0, resolve));
  try {
    assert.ok(navigationInstance.authenticate(token), 'a different serverless instance must authenticate the signed token');
    const status = await new Promise((resolve, reject) => {
      const req = httpRequest({ port: navigationServer.address().port, path: '/finance', headers: { Cookie: `osaah_session=${token}` } }, (response) => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
      req.on('error', reject); req.end();
    });
    assert.equal(status, 200, 'sidebar navigation must not return Authentication required on a different instance');
  } finally { await new Promise((resolve) => navigationServer.close(resolve)); }
});

test('every requested proprietor component opens its mapped implementation', async () => {
  const auth = createAuthService();
  const server = createServer(createApp({ auth }));
  await new Promise((resolve) => server.listen(0, resolve));
  const token = auth.login({ username: 'proprietor@osaah.edu.gh', password: 'Proprietor123!', portal: 'school' }).token;
  const request = (path) => new Promise((resolve, reject) => {
    const req = httpRequest({ port: server.address().port, path, headers: { Authorization: `Bearer ${token}` } }, (response) => {
      let body = ''; response.setEncoding('utf8'); response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    req.on('error', reject); req.end();
  });
  try {
    for (const item of PROPRIETOR_SIDEBAR_ROUTES) {
      const response = await request(item.route);
      assert.equal(response.status, 200, `${item.moduleName} (${item.route}) should render`);
      assert.match(response.body, /<!doctype html>/i, `${item.moduleName} should render a page, not a redirect or blank response`);
      const titleLabel = item.moduleName.replace(/&/g, '&amp;');
      assert.ok(response.body.includes(`<title>${titleLabel} | OsaaH Daylight</title>`), `${item.moduleName} should identify itself in the page title`);
    }
  } finally { await new Promise((resolve) => server.close(resolve)); }
});