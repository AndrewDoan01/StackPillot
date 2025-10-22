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
        console.log('1) Login unscoped via local API');
        const login = await axios.post(`${LOCAL}/api/auth/login`, { username, password, userDomainName: 'Default' });
        console.log('Login status', login.status, login.data.message);
        const unscoped = login.data.unscopedToken;

        console.log('2) Get projects');
        const projects = await axios.get(`${LOCAL}/api/auth/projects`, { headers: { 'x-auth-token': unscoped } });
        console.log('Projects:', projects.data.projects.length);
        const first = projects.data.projects[0];
        console.log('Using project:', first.name, first.id);

        console.log('3) Get scoped token');
        const scopedRes = await axios.post(`${LOCAL}/api/auth/scoped-token`, {
            username, password, userDomainName: 'Default', projectId: first.id
        });
        console.log('Scoped status', scopedRes.status);
        const scoped = scopedRes.data.scopedToken;

        console.log('4) Create network');
        const netRes = await axios.post(`${LOCAL}/api/network`, { name: 'test-network-' + Date.now() }, { headers: { 'x-auth-token': scoped, 'x-network-endpoint': scopedRes.data.endpoints.network } });
        console.log('Create network status', netRes.status, netRes.data.message);
        console.log('Network:', netRes.data.network);

    } catch (err) {
        console.error('Error:', err.response?.status, err.response?.data || err.message);
    }
}

run();
