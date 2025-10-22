// Client-side script for the OpenStack Management UI
(() => {
    const qs = id => document.getElementById(id);
    const loadingEl = qs('loading');
    const messageEl = qs('message');
    const testBtn = qs('testBtn');
    const loginBtn = qs('loginBtn');
    const usernameEl = qs('username');
    const passwordEl = qs('password');
    const domainEl = qs('userDomainName');
    const projectSection = qs('projectSection');
    const projectSelect = qs('projectSelect');
    const selectProjectBtn = qs('selectProjectBtn');
    const resourceSection = qs('resourceSection');

    let unscopedToken = null;
    let scopedToken = null;
    let endpoints = {};

    function setLoading(on) {
        loadingEl.style.display = on ? 'block' : 'none';
    }

    function showMessage(text, isError = false) {
        messageEl.textContent = text;
        messageEl.style.color = isError ? 'crimson' : 'green';
    }

    async function testConnection() {
        setLoading(true);
        showMessage('Testing connection...');
        try {
            const r = await fetch('/api/test');
            const j = await r.json();
            if (r.ok) showMessage('Connection OK: ' + (j.message || 'Accessible'));
            else showMessage('Connection failed: ' + (j.message || r.statusText), true);
        } catch (err) {
            showMessage('Connection error: ' + err.message, true);
        } finally { setLoading(false); }
    }

    async function login() {
        const username = usernameEl.value.trim();
        const password = passwordEl.value;
        const userDomainName = domainEl.value.trim() || 'Default';

        if (!username || !password) {
            showMessage('Username and password required', true);
            return;
        }

        setLoading(true);
        showMessage('Logging in...');

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, userDomainName })
            });

            const data = await res.json();
            if (!res.ok) {
                showMessage(data.message || 'Authentication failed', true);
                setLoading(false);
                return;
            }

            unscopedToken = data.unscopedToken;
            showMessage('Login successful — fetching projects...');

            // Get projects
            const pRes = await fetch('/api/auth/projects', {
                method: 'GET',
                headers: { 'x-auth-token': unscopedToken }
            });

            const pJson = await pRes.json();
            if (!pRes.ok) {
                showMessage(pJson.message || 'Failed to get projects', true);
                setLoading(false);
                return;
            }

            // Populate project select
            projectSelect.innerHTML = '<option value="">-- Select a project --</option>';
            (pJson.projects || []).forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name + ' (' + (p.id || '') + ')';
                projectSelect.appendChild(opt);
            });

            projectSection.style.display = '';
            showMessage('Choose a project and connect');

        } catch (err) {
            showMessage('Login error: ' + err.message, true);
        } finally {
            setLoading(false);
        }
    }

    async function connectProject() {
        const projectId = projectSelect.value;
        if (!projectId) { showMessage('Please select a project', true); return; }
        setLoading(true);
        showMessage('Getting scoped token for project...');

        try {
            const payload = {
                username: usernameEl.value.trim(),
                password: passwordEl.value,
                userDomainName: domainEl.value.trim() || 'Default',
                projectId
            };

            const r = await fetch('/api/auth/scoped-token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const j = await r.json();
            if (!r.ok) {
                showMessage(j.message || 'Failed to get scoped token', true);
                return;
            }

            // Store scoped token and endpoints for subsequent API calls
            scopedToken = j.scopedToken || j.scoped_token || null;
            endpoints = j.endpoints || {};

            // Show resources section
            resourceSection.style.display = '';
            showMessage('Connected to project: ' + (j.project?.name || projectId));

            // Refresh network list automatically
            await refreshNetworks();

        } catch (err) {
            showMessage('Error: ' + err.message, true);
        } finally { setLoading(false); }
    }

    // --- Network / Subnet / Port handlers
    const networkNameEl = qs('networkName');
    const createNetworkBtn = qs('createNetworkBtn');
    const networkSelect = qs('networkSelect');
    const subnetNameEl = qs('subnetName');
    const cidrEl = qs('cidr');
    const createSubnetBtn = qs('createSubnetBtn');
    const fixedIpEl = qs('fixedIp');
    const createPortBtn = qs('createPortBtn');
    const portIdEl = qs('portId');

    async function createNetwork() {
        if (!scopedToken) { showMessage('Not connected to a project', true); return; }
        const name = networkNameEl.value.trim();
        if (!name) { showMessage('Network name is required', true); return; }
        setLoading(true);
        showMessage('Creating network...');
        try {
            const res = await fetch('/api/network', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-auth-token': scopedToken,
                    'x-network-endpoint': endpoints.network || ''
                },
                body: JSON.stringify({ name })
            });
            const data = await res.json();
            if (!res.ok) {
                showMessage(data.message || 'Failed to create network', true);
                return;
            }
            showMessage('Network created: ' + (data.network?.name || data.network?.id || 'OK'));
            await refreshNetworks();
        } catch (err) {
            showMessage('Create network error: ' + err.message, true);
        } finally { setLoading(false); }
    }

    async function refreshNetworks() {
        if (!scopedToken) return;
        try {
            const r = await fetch('/api/networks', { headers: { 'x-auth-token': scopedToken } });
            const j = await r.json();
            if (!r.ok) { showMessage(j.message || 'Failed to load networks', true); return; }
            // populate network select
            networkSelect.innerHTML = '<option value="">-- Select a network --</option>';
            (j.networks || []).forEach(n => {
                const opt = document.createElement('option');
                opt.value = n.id || n.uuid || '';
                opt.textContent = n.name || n.id || opt.value;
                networkSelect.appendChild(opt);
            });
            showMessage('Loaded ' + (j.networks?.length || 0) + ' networks');
        } catch (err) {
            showMessage('Error loading networks: ' + err.message, true);
        }
    }

    async function createSubnet() {
        if (!scopedToken) { showMessage('Not connected to a project', true); return; }
        const name = subnetNameEl.value.trim();
        const networkId = networkSelect.value;
        const cidr = cidrEl.value.trim();
        if (!networkId || !cidr) { showMessage('Network and CIDR are required', true); return; }
        setLoading(true); showMessage('Creating subnet...');
        try {
            const res = await fetch('/api/subnet', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-auth-token': scopedToken, 'x-network-endpoint': endpoints.network || '' },
                body: JSON.stringify({ name, networkId, cidr })
            });
            const data = await res.json();
            if (!res.ok) { showMessage(data.message || 'Failed to create subnet', true); return; }
            showMessage('Subnet created: ' + (data.subnet?.id || data.subnet?.name || 'OK'));
        } catch (err) { showMessage('Create subnet error: ' + err.message, true); }
        finally { setLoading(false); }
    }

    async function createPort() {
        if (!scopedToken) { showMessage('Not connected to a project', true); return; }
        const networkId = networkSelect.value;
        const fixedIp = fixedIpEl.value.trim();
        if (!networkId) { showMessage('Please select a network', true); return; }
        setLoading(true); showMessage('Creating port...');
        try {
            const res = await fetch('/api/port', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-auth-token': scopedToken, 'x-network-endpoint': endpoints.network || '' },
                body: JSON.stringify({ networkId, fixedIp: fixedIp || undefined })
            });
            const data = await res.json();
            if (!res.ok) { showMessage(data.message || 'Failed to create port', true); return; }
            const portId = data.port?.id || data.port?.port?.id || '';
            portIdEl.value = portId;
            showMessage('Port created: ' + (portId || 'OK'));
        } catch (err) { showMessage('Create port error: ' + err.message, true); }
        finally { setLoading(false); }
    }

    // Attach handlers
    testBtn?.addEventListener('click', testConnection);
    loginBtn?.addEventListener('click', login);
    selectProjectBtn?.addEventListener('click', connectProject);

    // Network handlers
    createNetworkBtn?.addEventListener('click', createNetwork);
    createSubnetBtn?.addEventListener('click', createSubnet);
    createPortBtn?.addEventListener('click', createPort);

    // initial state
    setLoading(false);
})();
