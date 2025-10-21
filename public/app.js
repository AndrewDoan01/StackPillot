require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// OpenStack Endpoints
const ENDPOINTS = {
    identity: 'https://cloud-identity.uitiot.vn/v3',
    compute: 'https://cloud-compute.uitiot.vn/v2.1',
    image: 'https://cloud-image.uitiot.vn',
    network: 'https://cloud-network.uitiot.vn',
    loadbalancer: 'https://cloud-loadbalancer.uitiot.vn',
    placement: 'https://cloud-placement.uitiot.vn'
};

console.log('OpenStack Endpoints:', ENDPOINTS);

// Helper function to handle API errors
const handleApiError = (error, res, defaultMessage) => {
    console.error('API Error Details:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        headers: error.response?.headers,
        config: {
            url: error.config?.url,
            method: error.config?.method,
            data: error.config?.data
        }
    });

    const statusCode = error.response?.status || 500;
    const errorMessage = error.response?.data?.error?.message || 
                        error.response?.data?.message || 
                        error.message || 
                        defaultMessage;

    res.status(statusCode).json({
        success: false,
        message: errorMessage,
        details: error.response?.data,
        requestUrl: error.config?.url
    });
};

// Test endpoint
app.get('/api/test', async (req, res) => {
    try {
        console.log('Testing connection to:', ENDPOINTS.identity);
        const response = await axios.get(ENDPOINTS.identity, { 
            timeout: 10000,
            headers: {
                'Accept': 'application/json'
            }
        });
        res.json({
            success: true,
            message: 'OpenStack is accessible',
            version: response.data
        });
    } catch (error) {
        console.error('Test connection error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Cannot connect to OpenStack',
            error: error.message,
            endpoint: ENDPOINTS.identity
        });
    }
});

// STEP 1: Login - Get Unscoped Token
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password, userDomainName } = req.body;

        console.log('\n=== Login Request ===');
        console.log('Username:', username);
        console.log('User Domain:', userDomainName || 'Default');
        console.log('Endpoint:', `${ENDPOINTS.identity}/auth/tokens`);

        // Validate input
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Username and password are required'
            });
        }

        // Build authentication payload
        const authPayload = {
            auth: {
                identity: {
                    methods: ['password'],
                    password: {
                        user: {
                            name: username,
                            domain: { 
                                name: userDomainName || 'Default' 
                            },
                            password: password
                        }
                    }
                }
            }
        };

        console.log('Auth Payload:', JSON.stringify(authPayload, null, 2));

        // Make request to Keystone
        const response = await axios.post(
            `${ENDPOINTS.identity}/auth/tokens`,
            authPayload,
            {
                headers: { 
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 15000,
                validateStatus: function (status) {
                    // Accept any status code to handle it manually
                    return status >= 200 && status < 600;
                }
            }
        );

        console.log('Response Status:', response.status);
        console.log('Response Headers:', response.headers);

        // Check if authentication was successful
        if (response.status === 201) {
            const unscopedToken = response.headers['x-subject-token'];
            const userData = response.data.token;

            console.log('✓ Authentication successful');
            console.log('Token received:', unscopedToken ? 'Yes' : 'No');

            if (!unscopedToken) {
                throw new Error('Token not found in response headers');
            }

            res.json({
                success: true,
                message: 'Login successful - unscoped token received',
                unscopedToken: unscopedToken,
                user: {
                    id: userData.user.id,
                    name: userData.user.name,
                    domain: userData.user.domain
                }
            });
        } else {
            // Authentication failed
            console.error('✗ Authentication failed with status:', response.status);
            console.error('Response data:', response.data);
            
            res.status(response.status).json({
                success: false,
                message: response.data?.error?.message || 'Authentication failed',
                details: response.data
            });
        }

    } catch (error) {
        console.error('\n✗ Login error:', error.message);
        
        if (error.code === 'ECONNREFUSED') {
            return res.status(500).json({
                success: false,
                message: 'Cannot connect to OpenStack server. Please check the endpoint URL.',
                endpoint: ENDPOINTS.identity
            });
        }
        
        if (error.code === 'ETIMEDOUT') {
            return res.status(500).json({
                success: false,
                message: 'Connection timeout. The server is not responding.',
                endpoint: ENDPOINTS.identity
            });
        }

        handleApiError(error, res, 'Login failed');
    }
});

// STEP 2: Get Projects List
app.get('/api/auth/projects', async (req, res) => {
    try {
        const unscopedToken = req.headers['x-auth-token'];

        if (!unscopedToken) {
            return res.status(400).json({
                success: false,
                message: 'Missing unscoped token'
            });
        }

        console.log('\n=== Get Projects Request ===');
        console.log('Token:', unscopedToken.substring(0, 30) + '...');

        const response = await axios.get(
            `${ENDPOINTS.identity}/auth/projects`,
            {
                headers: { 
                    'X-Auth-Token': unscopedToken,
                    'Accept': 'application/json'
                },
                timeout: 10000
            }
        );

        const projects = response.data.projects;
        console.log(`✓ Found ${projects.length} projects`);

        res.json({
            success: true,
            projects: projects
        });

    } catch (error) {
        console.error('Get projects error:', error.message);
        handleApiError(error, res, 'Failed to get projects');
    }
});

// STEP 3: Get Scoped Token for a Project
app.post('/api/auth/scoped-token', async (req, res) => {
    try {
        const { username, password, userDomainName, projectId, projectName, projectDomainName } = req.body;

        console.log('\n=== Get Scoped Token Request ===');
        console.log('Project:', projectName || projectId);

        // Build authentication payload with project scope
        const authPayload = {
            auth: {
                identity: {
                    methods: ['password'],
                    password: {
                        user: {
                            name: username,
                            domain: { name: userDomainName || 'Default' },
                            password: password
                        }
                    }
                },
                scope: {
                    project: projectId ? 
                        { id: projectId } : 
                        { 
                            name: projectName,
                            domain: { name: projectDomainName || 'Default' }
                        }
                }
            }
        };

        console.log('Auth Payload:', JSON.stringify(authPayload, null, 2));

        const response = await axios.post(
            `${ENDPOINTS.identity}/auth/tokens`,
            authPayload,
            {
                headers: { 
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 15000
            }
        );

        const scopedToken = response.headers['x-subject-token'];
        const tokenData = response.data.token;

        console.log('✓ Scoped token received');

        // Get project ID from token data
        const projectIdFromToken = tokenData.project.id;

        // Update compute endpoint with project ID
        const computeEndpoint = `${ENDPOINTS.compute}/${projectIdFromToken}`;

        res.json({
            success: true,
            message: 'Scoped token received',
            scopedToken: scopedToken,
            endpoints: {
                identity: ENDPOINTS.identity,
                compute: computeEndpoint,
                image: ENDPOINTS.image,
                network: ENDPOINTS.network,
                loadbalancer: ENDPOINTS.loadbalancer,
                placement: ENDPOINTS.placement
            },
            project: {
                id: tokenData.project.id,
                name: tokenData.project.name,
                domain: tokenData.project.domain
            },
            user: {
                id: tokenData.user.id,
                name: tokenData.user.name,
                domain: tokenData.user.domain
            },
            catalog: tokenData.catalog
        });

    } catch (error) {
        console.error('Get scoped token error:', error.message);
        handleApiError(error, res, 'Failed to get scoped token');
    }
});

// Get Images (Glance API)
app.get('/api/images', async (req, res) => {
    try {
        const token = req.headers['x-auth-token'];

        if (!token) {
            return res.status(400).json({
                success: false,
                message: 'Missing auth token'
            });
        }

        console.log('Getting images from Glance');

        const response = await axios.get(
            `${ENDPOINTS.image}/v2/images`,
            {
                headers: { 
                    'X-Auth-Token': token,
                    'Accept': 'application/json'
                },
                timeout: 10000
            }
        );

        res.json({
            success: true,
            images: response.data.images
        });

    } catch (error) {
        handleApiError(error, res, 'Failed to get images');
    }
});

// Get Flavors (Nova API)
app.get('/api/flavors', async (req, res) => {
    try {
        const token = req.headers['x-auth-token'];
        const computeEndpoint = req.headers['x-compute-endpoint'];

        if (!token || !computeEndpoint) {
            return res.status(400).json({
                success: false,
                message: 'Missing token or compute endpoint'
            });
        }

        console.log('Getting flavors from Nova');

        const response = await axios.get(
            `${computeEndpoint}/flavors/detail`,
            {
                headers: { 
                    'X-Auth-Token': token,
                    'Accept': 'application/json'
                },
                timeout: 10000
            }
        );

        res.json({
            success: true,
            flavors: response.data.flavors
        });

    } catch (error) {
        handleApiError(error, res, 'Failed to get flavors');
    }
});

// Get Networks (Neutron API)
app.get('/api/networks', async (req, res) => {
    try {
        const token = req.headers['x-auth-token'];

        console.log('Getting networks from Neutron');

        const response = await axios.get(
            `${ENDPOINTS.network}/v2.0/networks`,
            {
                headers: { 
                    'X-Auth-Token': token,
                    'Accept': 'application/json'
                },
                timeout: 10000
            }
        );

        res.json({
            success: true,
            networks: response.data.networks
        });

    } catch (error) {
        handleApiError(error, res, 'Failed to get networks');
    }
});

// Get Security Groups (Neutron API)
app.get('/api/security-groups', async (req, res) => {
    try {
        const token = req.headers['x-auth-token'];

        console.log('Getting security groups from Neutron');

        const response = await axios.get(
            `${ENDPOINTS.network}/v2.0/security-groups`,
            {
                headers: { 
                    'X-Auth-Token': token,
                    'Accept': 'application/json'
                },
                timeout: 10000
            }
        );

        res.json({
            success: true,
            securityGroups: response.data.security_groups
        });

    } catch (error) {
        handleApiError(error, res, 'Failed to get security groups');
    }
});

// Get Keypairs (Nova API)
app.get('/api/keypairs', async (req, res) => {
    try {
        const token = req.headers['x-auth-token'];
        const computeEndpoint = req.headers['x-compute-endpoint'];

        console.log('Getting keypairs from Nova');

        const response = await axios.get(
            `${computeEndpoint}/os-keypairs`,
            {
                headers: { 
                    'X-Auth-Token': token,
                    'Accept': 'application/json'
                },
                timeout: 10000
            }
        );

        res.json({
            success: true,
            keypairs: response.data.keypairs
        });

    } catch (error) {
        handleApiError(error, res, 'Failed to get keypairs');
    }
});

// Create Network (Neutron API)
app.post('/api/network', async (req, res) => {
    try {
        const token = req.headers['x-auth-token'];
        const { name } = req.body;

        console.log('Creating network:', name);

        const response = await axios.post(
            `${ENDPOINTS.network}/v2.0/networks`,
            {
                network: {
                    name: name,
                    admin_state_up: true
                }
            },
            {
                headers: { 
                    'X-Auth-Token': token,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 10000
            }
        );

        res.json({
            success: true,
            message: `Created network with id: ${response.data.network.id}`,
            network: response.data.network
        });

    } catch (error) {
        handleApiError(error, res, 'Failed to create network');
    }
});

// Create Subnet (Neutron API)
app.post('/api/subnet', async (req, res) => {
    try {
        const token = req.headers['x-auth-token'];
        const { name, networkId, cidr } = req.body;

        console.log('Creating subnet:', name);

        const response = await axios.post(
            `${ENDPOINTS.network}/v2.0/subnets`,
            {
                subnet: {
                    name: name,
                    network_id: networkId,
                    ip_version: 4,
                    cidr: cidr
                }
            },
            {
                headers: { 
                    'X-Auth-Token': token,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 10000
            }
        );

        res.json({
            success: true,
            message: `Created subnet with id: ${response.data.subnet.id}`,
            subnet: response.data.subnet
        });

    } catch (error) {
        handleApiError(error, res, 'Failed to create subnet');
    }
});

// Create Port (Neutron API)
app.post('/api/port', async (req, res) => {
    try {
        const token = req.headers['x-auth-token'];
        const { networkId, fixedIp } = req.body;

        console.log('Creating port on network:', networkId);

        const portPayload = {
            port: {
                network_id: networkId,
                admin_state_up: true
            }
        };

        if (fixedIp) {
            portPayload.port.fixed_ips = [{ ip_address: fixedIp }];
        }

        const response = await axios.post(
            `${ENDPOINTS.network}/v2.0/ports`,
            portPayload,
            {
                headers: { 
                    'X-Auth-Token': token,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 10000
            }
        );

        res.json({
            success: true,
            message: `Created port with id: ${response.data.port.id}`,
            port: response.data.port
        });

    } catch (error) {
        handleApiError(error, res, 'Failed to create port');
    }
});

// Create Instance (Nova API)
app.post('/api/instance', async (req, res) => {
    try {
        const token = req.headers['x-auth-token'];
        const computeEndpoint = req.headers['x-compute-endpoint'];
        const { name, imageId, flavorId, portId, securityGroups, customScript } = req.body;

        console.log('Creating instance:', name);

        const instancePayload = {
            server: {
                name: name,
                imageRef: imageId,
                flavorRef: flavorId,
                networks: [{ port: portId }]
            }
        };

        if (securityGroups && securityGroups.length > 0) {
            instancePayload.server.security_groups = securityGroups.map(sg => ({ name: sg }));
        }

        if (customScript) {
            instancePayload.server.user_data = Buffer.from(customScript).toString('base64');
        }

        const response = await axios.post(
            `${computeEndpoint}/servers`,
            instancePayload,
            {
                headers: { 
                    'X-Auth-Token': token,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 15000
            }
        );

        res.json({
            success: true,
            message: 'Instance created successfully',
            instance: response.data.server
        });

    } catch (error) {
        handleApiError(error, res, 'Failed to create instance');
    }
});

// Get Instances (Nova API)
app.get('/api/instances', async (req, res) => {
    try {
        const token = req.headers['x-auth-token'];
        const computeEndpoint = req.headers['x-compute-endpoint'];

        console.log('Getting instances from Nova');

        const response = await axios.get(
            `${computeEndpoint}/servers/detail`,
            {
                headers: { 
                    'X-Auth-Token': token,
                    'Accept': 'application/json'
                },
                timeout: 10000
            }
        );

        res.json({
            success: true,
            instances: response.data.servers
        });

    } catch (error) {
        handleApiError(error, res, 'Failed to get instances');
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: err.message
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`OpenStack Client Server - UIT IoT Cloud`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Server running on: http://localhost:${PORT}`);
    console.log(`\nEndpoints:`);
    Object.entries(ENDPOINTS).forEach(([service, url]) => {
        console.log(`  ${service.padEnd(15)}: ${url}`);
    });
    console.log(`${'='.repeat(60)}\n`);
});