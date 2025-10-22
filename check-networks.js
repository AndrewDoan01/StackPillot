const axios = require('axios');

const LOCAL = 'http://localhost:3000';

async function run() {
  const username = process.env.TEST_USERNAME;
  const password = process.env.TEST_PASSWORD;
  if (!username || !password) {
    console.error('Set TEST_USERNAME and TEST_PASSWORD in environment');
    process.exit(1);
  }

  try {
    const login = await axios.post(`${LOCAL}/api/auth/login`, { username, password, userDomainName: 'Default' });
    const unscoped = login.data.unscopedToken;
    const projects = await axios.get(`${LOCAL}/api/auth/projects`, { headers: { 'x-auth-token': unscoped } });
    const first = projects.data.projects[0];
    const scopedRes = await axios.post(`${LOCAL}/api/auth/scoped-token`, { username, password, userDomainName: 'Default', projectId: first.id });
  const scoped = scopedRes.data.scopedToken;
  const networkEndpoint = scopedRes.data.endpoints?.network;

  console.log('Scoped token:', scoped ? 'present' : 'missing');
  console.log('Using network endpoint:', networkEndpoint);

  const nets = await axios.get(`${LOCAL}/api/networks`, { headers: { 'x-auth-token': scoped, 'x-network-endpoint': networkEndpoint } });
    console.log('Networks response status:', nets.status);
    console.log('Networks keys:', Object.keys(nets.data));
    console.log('Networks length:', (nets.data.networks || []).length);
    console.log(JSON.stringify(nets.data.networks, null, 2));
  } catch (err) {
    console.error('Error:', err.response?.status, err.response?.data || err.message);
  }
}

run();
