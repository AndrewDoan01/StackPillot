const axios = require('axios');

// Test login với UIT IoT Cloud
async function testLogin() {
    const IDENTITY_URL = 'https://cloud-identity.uitiot.vn/v3';
    
    // Credentials are read from environment variables for safety.
    // Create a .env file or set these vars in your environment before running.
    const credentials = {
        username: process.env.TEST_USERNAME || process.env.USERNAME || '',
        password: process.env.TEST_PASSWORD || '',
        userDomainName: process.env.USER_DOMAIN_NAME || 'Default'
    };
    
    console.log('Testing login to UIT IoT Cloud...');
    console.log('Endpoint:', IDENTITY_URL + '/auth/tokens');
    console.log('Username:', credentials.username ? 'set' : 'NOT SET');
    console.log('Domain:', credentials.userDomainName);
    
    const authPayload = {
        auth: {
            identity: {
                methods: ['password'],
                password: {
                    user: {
                        name: credentials.username,
                        domain: { name: credentials.userDomainName },
                        password: credentials.password
                    }
                }
            }
        }
    };
    
    console.log('\nAuth Payload: (credentials masked)');
    const masked = JSON.parse(JSON.stringify(authPayload));
    if (masked.auth?.identity?.password?.user) {
        masked.auth.identity.password.user.password = '*****';
    }
    console.log(JSON.stringify(masked, null, 2));
    
    try {
        const response = await axios.post(
            IDENTITY_URL + '/auth/tokens',
            authPayload,
            {
                headers: { 
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 15000,
                validateStatus: function (status) {
                    return status >= 200 && status < 600;
                }
            }
        );
        
        console.log('\n=== Response ===');
        console.log('Status:', response.status);
        console.log('Status Text:', response.statusText);
        console.log('\nHeaders:');
        console.log(JSON.stringify(response.headers, null, 2));
        
        if (response.status === 201) {
            const token = response.headers['x-subject-token'];
            console.log('\n✓ Login successful!');
            console.log('Token:', token ? token.substring(0, 50) + '...' : 'NOT FOUND');
            console.log('\nUser Info:');
            console.log(JSON.stringify(response.data.token.user, null, 2));
        } else {
            console.log('\n✗ Login failed!');
            console.log('Error:', JSON.stringify(response.data, null, 2));
        }
        
    } catch (error) {
        console.error('\n✗ Error occurred:');
        console.error('Message:', error.message);
        console.error('Code:', error.code);
        
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        }
    }
}

testLogin();