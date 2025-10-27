require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// OpenStack Configuration
const OPENSTACK_AUTH_URL = process.env.OPENSTACK_AUTH_URL;
const OPENSTACK_REGION = process.env.OPENSTACK_REGION || 'RegionOne';

// Helper function to get service endpoint
function getServiceEndpoint(catalog, serviceType, interfaceType = 'public') {
    const service = catalog.find(s => s.type === serviceType);
    if (!service) return null;

    const endpoint = service.endpoints.find(e =>
        e.interface === interfaceType && e.region === OPENSTACK_REGION
    );

    return endpoint ? endpoint.url : null;
}

// Ensure network endpoint includes version path (default to /v2.0)
function getNetworkBaseFromHeaderOrCatalog(req) {
    const headerUrl = req.headers['x-network-endpoint'];
    let base = '';
    if (headerUrl) {
        base = headerUrl;
    } else {
        try {
            const authUrl = new URL(OPENSTACK_AUTH_URL);
            base = authUrl.origin + '/network';
        } catch (e) {
            // fallback: try to strip known suffix
            base = OPENSTACK_AUTH_URL.replace(/identity\/?v?3?\/?$/i, '').replace(/\/+$/, '') + '/network';
        }
    }
    // If base does not contain a version segment like /v2, append /v2.0
    if (!/\/v\d+/i.test(base)) {
        base = base.replace(/\/+$/, '') + '/v2.0';
    }
    // remove trailing slash
    return base.replace(/\/+$/, '');
}

// ============================================
// API ROUTES
// ============================================

// Test connection
app.get('/api/test', async (req, res) => {
    try {
        const response = await axios.get(OPENSTACK_AUTH_URL, {
            timeout: 5000
        });

        res.json({
            success: true,
            message: 'Connected to OpenStack',
            version: response.data.version
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Cannot connect to OpenStack',
            error: error.message
        });
    }
});

// Login - Get unscoped token
app.post('/api/auth/login', async (req, res) => {
    const { username, password, userDomainName = 'Default' } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            message: 'Username and password are required'
        });
    }

    try {
        const authData = {
            auth: {
                identity: {
                    methods: ['password'],
                    password: {
                        user: {
                            name: username,
                            domain: { name: userDomainName },
                            password: password
                        }
                    }
                }
            }
        };

        console.log('Login attempt for user:', username);

        const response = await axios.post(
            `${OPENSTACK_AUTH_URL}/auth/tokens`,
            authData,
            {
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );

        const unscopedToken = response.headers['x-subject-token'];

        res.status(201).json({
            success: true,
            message: 'Login successful',
            unscopedToken: unscopedToken,
            user: response.data.token.user
        });

    } catch (error) {
        console.error('Login error:', error.response?.data || error.message);
        res.status(401).json({
            success: false,
            message: 'Authentication failed',
            error: error.response?.data?.error?.message || error.message
        });
    }
});

// Get projects
app.get('/api/auth/projects', async (req, res) => {
    const token = req.headers['x-auth-token'];

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Token is required'
        });
    }

    try {
        const response = await axios.get(
            `${OPENSTACK_AUTH_URL}/auth/projects`,
            {
                headers: {
                    'X-Auth-Token': token
                }
            }
        );

        res.json({
            success: true,
            projects: response.data.projects
        });

    } catch (error) {
        console.error('Get projects error:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to get projects',
            error: error.response?.data?.error?.message || error.message
        });
    }
});

// Get scoped token
app.post('/api/auth/scoped-token', async (req, res) => {
    const { username, password, userDomainName, projectId, projectName, projectDomainName } = req.body;

    try {
        const authData = {
            auth: {
                identity: {
                    methods: ['password'],
                    password: {
                        user: {
                            name: username,
                            domain: { name: userDomainName },
                            password: password
                        }
                    }
                },
                scope: {
                    project: {
                        id: projectId
                    }
                }
            }
        };

        const response = await axios.post(
            `${OPENSTACK_AUTH_URL}/auth/tokens`,
            authData,
            {
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );

        const scopedToken = response.headers['x-subject-token'];
        const catalog = response.data.token.catalog;

        const endpoints = {
            compute: getServiceEndpoint(catalog, 'compute'),
            network: getServiceEndpoint(catalog, 'network'),
            image: getServiceEndpoint(catalog, 'image'),
            volume: getServiceEndpoint(catalog, 'volumev3')
        };

        res.json({
            success: true,
            scopedToken: scopedToken,
            project: response.data.token.project,
            endpoints: endpoints
        });

    } catch (error) {
        console.error('Get scoped token error:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to get scoped token',
            error: error.response?.data?.error?.message || error.message
        });
    }
});

// Get images
app.get('/api/images', async (req, res) => {
    const token = req.headers['x-auth-token'];

    try {
        // allow client to provide image endpoint (from token catalog) via header
        let imageBase = req.headers['x-image-endpoint'];
        if (!imageBase) {
            imageBase = OPENSTACK_AUTH_URL.replace('/identity/v3', '') + '/image/v2';
        }
        if (!/\/v\d+/i.test(imageBase)) {
            imageBase = imageBase.replace(/\/+$/, '') + '/v2';
        }

        const response = await axios.get(
            `${imageBase}/images`,
            {
                headers: {
                    'X-Auth-Token': token
                }
            }
        );

        res.json({
            success: true,
            images: response.data.images
        });

    } catch (error) {
        console.error('Get images error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to get images',
            error: error.message
        });
    }
});

// Get flavors
app.get('/api/flavors', async (req, res) => {
    const token = req.headers['x-auth-token'];
    const computeEndpoint = req.headers['x-compute-endpoint'];

    try {
        const response = await axios.get(
            `${computeEndpoint}/flavors/detail`,
            {
                headers: {
                    'X-Auth-Token': token
                }
            }
        );

        res.json({
            success: true,
            flavors: response.data.flavors
        });

    } catch (error) {
        console.error('Get flavors error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to get flavors',
            error: error.message
        });
    }
});

// Get networks
app.get('/api/networks', async (req, res) => {
    const token = req.headers['x-auth-token'];

    try {
        const networkBase = getNetworkBaseFromHeaderOrCatalog(req);
        console.log('GET /api/networks -> networkBase =', networkBase);
        const response = await axios.get(
            `${networkBase}/networks`,
            {
                headers: {
                    'X-Auth-Token': token
                }
            }
        );

        res.json({
            success: true,
            networks: response.data.networks
        });

    } catch (error) {
        console.error('Get networks error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to get networks',
            error: error.message
        });
    }
});

// Get security groups
app.get('/api/security-groups', async (req, res) => {
    const token = req.headers['x-auth-token'];

    try {
        const response = await axios.get(
            `${OPENSTACK_AUTH_URL.replace('/identity/v3', '')}/network/v2.0/security-groups`,
            {
                headers: {
                    'X-Auth-Token': token
                }
            }
        );

        res.json({
            success: true,
            securityGroups: response.data.security_groups
        });

    } catch (error) {
        console.error('Get security groups error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to get security groups',
            error: error.message
        });
    }
});

// Get keypairs
app.get('/api/keypairs', async (req, res) => {
    const token = req.headers['x-auth-token'];
    const computeEndpoint = req.headers['x-compute-endpoint'];

    try {
        const response = await axios.get(
            `${computeEndpoint}/os-keypairs`,
            {
                headers: {
                    'X-Auth-Token': token
                }
            }
        );

        res.json({
            success: true,
            keypairs: response.data.keypairs
        });

    } catch (error) {
        console.error('Get keypairs error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to get keypairs',
            error: error.message
        });
    }
});

// Create network
app.post('/api/network', async (req, res) => {
    const token = req.headers['x-auth-token'];
    const { name } = req.body;

    try {
        const networkBase = getNetworkBaseFromHeaderOrCatalog(req);
        const response = await axios.post(
            `${networkBase}/networks`,
            {
                network: {
                    name: name,
                    admin_state_up: true
                }
            },
            {
                headers: {
                    'X-Auth-Token': token,
                    'Content-Type': 'application/json'
                }
            }
        );

        res.json({
            success: true,
            message: 'Network created successfully',
            network: response.data.network
        });

    } catch (error) {
        console.error('Create network error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to create network',
            error: error.message
        });
    }
});

// Create subnet
app.post('/api/subnet', async (req, res) => {
    const token = req.headers['x-auth-token'];
    const { name, networkId, cidr } = req.body;

    try {
        const networkBase = getNetworkBaseFromHeaderOrCatalog(req);
        const response = await axios.post(
            `${networkBase}/subnets`,
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
                    'Content-Type': 'application/json'
                }
            }
        );

        res.json({
            success: true,
            message: 'Subnet created successfully',
            subnet: response.data.subnet
        });

    } catch (error) {
        console.error('Create subnet error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to create subnet',
            error: error.message
        });
    }
});

// Create port
app.post('/api/port', async (req, res) => {
    const token = req.headers['x-auth-token'];
    const { networkId, fixedIp } = req.body;

    try {
        const portData = {
            port: {
                network_id: networkId,
                admin_state_up: true
            }
        };

        if (fixedIp) {
            portData.port.fixed_ips = [{ ip_address: fixedIp }];
        }

        const networkBase = getNetworkBaseFromHeaderOrCatalog(req);
        const response = await axios.post(
            `${networkBase}/ports`,
            portData,
            {
                headers: {
                    'X-Auth-Token': token,
                    'Content-Type': 'application/json'
                }
            }
        );

        res.json({
            success: true,
            message: 'Port created successfully',
            port: response.data.port
        });

    } catch (error) {
        console.error('Create port error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to create port',
            error: error.message
        });
    }
});

// Create instance
app.post('/api/instance', async (req, res) => {
    const token = req.headers['x-auth-token'];
    const computeEndpoint = req.headers['x-compute-endpoint'];
    const { name, imageId, flavorId, portId, securityGroups, customScript } = req.body;

    try {
        const serverData = {
            server: {
                name: name,
                imageRef: imageId,
                flavorRef: flavorId,
                networks: [{ port: portId }]
            }
        };

        // Debug: log incoming create-instance request and payload sent to Nova
        console.log('Incoming /api/instance request body:', req.body);
        console.log('Computed server payload for Nova:', JSON.stringify(serverData, null, 2));

        if (securityGroups && securityGroups.length > 0) {
            serverData.server.security_groups = securityGroups.map(sg => ({ name: sg }));
        }

        if (customScript) {
            serverData.server.user_data = Buffer.from(customScript).toString('base64');
        }

        const response = await axios.post(
            `${computeEndpoint}/servers`,
            serverData,
            {
                headers: {
                    'X-Auth-Token': token,
                    'Content-Type': 'application/json'
                }
            }
        );

        res.json({
            success: true,
            message: 'Instance created successfully',
            instance: response.data.server
        });

    } catch (error) {
        console.error('Create instance error:', error.response?.data || error.message);
        // Prefer the real status code from nova if available
        const status = error.response?.status || 500;
        const details = error.response?.data || { message: error.message };
        // Try to extract a human-friendly message from common OpenStack error shapes
        const humanMessage = details.forbidden?.message || details.error?.message || details.message || details.badRequest?.message || error.message;

        res.status(status).json({
            success: false,
            message: 'Failed to create instance: ' + humanMessage,
            details: details
        });
    }
});

// Delete port (cleanup helper)
app.delete('/api/port/:id', async (req, res) => {
    const token = req.headers['x-auth-token'];
    const portId = req.params.id;

    if (!token) {
        return res.status(401).json({ success: false, message: 'Token is required' });
    }

    try {
        const networkBase = getNetworkBaseFromHeaderOrCatalog(req);
        const response = await axios.delete(
            `${networkBase}/ports/${portId}`,
            {
                headers: {
                    'X-Auth-Token': token
                }
            }
        );

        res.json({
            success: true,
            message: 'Port deleted successfully',
            result: response.data
        });

    } catch (error) {
        console.error('Delete port error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({
            success: false,
            message: 'Failed to delete port',
            details: error.response?.data || error.message
        });
    }
});

// Get instances
app.get('/api/instances', async (req, res) => {
    const token = req.headers['x-auth-token'];
    const computeEndpoint = req.headers['x-compute-endpoint'];

    try {
        const response = await axios.get(
            `${computeEndpoint}/servers/detail`,
            {
                headers: {
                    'X-Auth-Token': token
                }
            }
        );

        res.json({
            success: true,
            instances: response.data.servers
        });

    } catch (error) {
        console.error('Get instances error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to get instances',
            error: error.message
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`📡 OpenStack Auth URL: ${OPENSTACK_AUTH_URL}`);
});