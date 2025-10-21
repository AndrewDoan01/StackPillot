const axios = require('axios');

async function testLocalLogin() {
    const LOCAL_URL = 'http://localhost:3000/api/auth/login';
    const credentials = {
        username: process.env.TEST_USERNAME || process.env.USERNAME || '',
        password: process.env.TEST_PASSWORD || '',
        userDomainName: process.env.USER_DOMAIN_NAME || 'Default'
    };

    console.log('Testing local login via', LOCAL_URL);

    try {
        const response = await axios.post(
            LOCAL_URL,
            credentials,
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: 15000
            }
        );

        console.log('\n=== Local Response ===');
        console.log('Status:', response.status);
        // Mask token in output
        const out = JSON.parse(JSON.stringify(response.data));
        if (out.unscopedToken) out.unscopedToken = out.unscopedToken.substring(0, 20) + '...';
        console.log('Body:', JSON.stringify(out, null, 2));

    } catch (error) {
        console.error('\n✗ Error when calling local API:');
        console.error('Message:', error.message);
        console.error('Stack:', error.stack);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Headers:', JSON.stringify(error.response.headers, null, 2));
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        }
    }
}

testLocalLogin();
