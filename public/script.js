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

    function showMessage(text, isError = false, details = null) {
        messageEl.textContent = text;
        messageEl.style.color = isError ? 'crimson' : 'green';
        const detailsEl = qs('messageDetails');
        if (!detailsEl) return;
        if (details) {
            try {
                detailsEl.textContent = typeof details === 'string' ? details : JSON.stringify(details, null, 2);
            } catch (e) {
                detailsEl.textContent = String(details);
            }
            detailsEl.style.display = 'block';
        } else {
            detailsEl.style.display = 'none';
            detailsEl.textContent = '';
        }
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
                showMessage(data.message || 'Authentication failed', true, data.details || data);
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
                showMessage(pJson.message || 'Failed to get projects', true, pJson.details || pJson);
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
                showMessage(j.message || 'Failed to get scoped token', true, j.details || j);
                return;
            }

            // Store scoped token and endpoints for subsequent API calls
            scopedToken = j.scopedToken || j.scoped_token || null;
            endpoints = j.endpoints || {};

            // Show resources section
            resourceSection.style.display = '';
            showMessage('Connected to project: ' + (j.project?.name || projectId));

            // Refresh resource lists automatically
            await refreshNetworks();
            await fetchImages();
            await fetchFlavors();
            await fetchKeypairs();
            await refreshInstances();

        } catch (err) {
            showMessage('Error: ' + err.message, true);
        } finally { setLoading(false); }
    }

    // --- Network / Subnet / Port handlers
    const networkNameEl = qs('networkName');
    const createNetworkBtn = qs('createNetworkBtn');
    const networkSelect = qs('networkSelect');
    const refreshNetworksBtn = qs('refreshNetworksBtn');
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
                showMessage(data.message || 'Failed to create network', true, data.details || data);
                return;
            }
            showMessage('Network created: ' + (data.network?.name || data.network?.id || 'OK'), false, data);
            await refreshNetworks();
        } catch (err) {
            showMessage('Create network error: ' + err.message, true);
        } finally { setLoading(false); }
    }

    async function refreshNetworks() {
        if (!scopedToken) return;
        try {
            const r = await fetch('/api/networks', { headers: { 'x-auth-token': scopedToken, 'x-network-endpoint': endpoints.network || '' } });
            const j = await r.json();
            if (!r.ok) { showMessage(j.message || 'Failed to load networks', true, j.details || j); return; }
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

    // --- Images / Flavors / Keypairs / Instances handlers
    const imageSelect = qs('imageSelect');
    const flavorSelect = qs('flavorSelect');
    const keypairSelect = qs('keypairSelect');
    const instanceNameEl = qs('instanceName');
    const createInstanceBtn = qs('createInstanceBtn');
    const refreshInstancesBtn = qs('refreshInstancesBtn');
    const instancesList = qs('instancesList');

    async function fetchImages() {
        if (!scopedToken) return;
        try {
            const r = await fetch('/api/images', { headers: { 'x-auth-token': scopedToken, 'x-image-endpoint': endpoints.image || '' } });
            const j = await r.json();
            if (!r.ok) { showMessage(j.message || 'Failed to load images', true, j.details || j); return; }
            imageSelect.innerHTML = '<option value="">-- Select an image --</option>';
            (j.images || []).forEach(img => {
                const opt = document.createElement('option');
                opt.value = img.id || img.uuid || '';
                opt.textContent = (img.name || img.id || opt.value) + (img.min_disk ? ` (min_disk:${img.min_disk}GB)` : '');
                imageSelect.appendChild(opt);
            });
            showMessage('Loaded ' + (j.images?.length || 0) + ' images');
        } catch (err) {
            showMessage('Error loading images: ' + err.message, true);
        }
    }

    async function fetchFlavors() {
        if (!scopedToken) return;
        try {
            const r = await fetch('/api/flavors', { headers: { 'x-auth-token': scopedToken, 'x-compute-endpoint': endpoints.compute || '' } });
            const j = await r.json();
            if (!r.ok) { showMessage(j.message || 'Failed to load flavors', true, j.details || j); return; }
            flavorSelect.innerHTML = '<option value="">-- Select a flavor --</option>';
            (j.flavors || []).forEach(f => {
                const opt = document.createElement('option');
                opt.value = f.id || f.flavorid || '';
                opt.textContent = (f.name || f.id || opt.value) + (f.disk ? ` (disk:${f.disk}GB)` : '');
                flavorSelect.appendChild(opt);
            });
            showMessage('Loaded ' + (j.flavors?.length || 0) + ' flavors');
        } catch (err) {
            showMessage('Error loading flavors: ' + err.message, true);
        }
    }

    async function fetchKeypairs() {
        if (!scopedToken) return;
        try {
            const r = await fetch('/api/keypairs', { headers: { 'x-auth-token': scopedToken, 'x-compute-endpoint': endpoints.compute || '' } });
            const j = await r.json();
            if (!r.ok) { showMessage(j.message || 'Failed to load keypairs', true, j.details || j); return; }
            keypairSelect.innerHTML = '<option value="">-- No keypair --</option>';
            (j.keypairs || []).forEach(k => {
                const opt = document.createElement('option');
                const name = k.keypair?.name || k.name || k.key_name || '';
                opt.value = name;
                opt.textContent = name;
                keypairSelect.appendChild(opt);
            });
            showMessage('Loaded ' + (j.keypairs?.length || 0) + ' keypairs');
        } catch (err) {
            showMessage('Error loading keypairs: ' + err.message, true);
        }
    }

    async function refreshInstances() {
        if (!scopedToken) return;
        try {
            const r = await fetch('/api/instances', { headers: { 'x-auth-token': scopedToken, 'x-compute-endpoint': endpoints.compute || '' } });
            const j = await r.json();
            if (!r.ok) { showMessage(j.message || 'Failed to load instances', true, j.details || j); return; }
            instancesList.innerHTML = '';
            (j.instances || []).forEach(s => {
                const div = document.createElement('div');
                div.className = 'instance-item';
                div.textContent = `${s.name || s.id} — ${s.status || ''} — ${s.id}`;
                instancesList.appendChild(div);
            });
            showMessage('Loaded ' + (j.instances?.length || 0) + ' instances');
        } catch (err) {
            showMessage('Error loading instances: ' + err.message, true);
        }
    }

    async function createInstance() {
        if (!scopedToken) { showMessage('Not connected to a project', true); return; }
        const name = instanceNameEl.value.trim() || ('instance-' + Date.now());
        const imageId = imageSelect.value;
        const flavorId = flavorSelect.value;
        const portId = portIdEl.value.trim();
        const keypair = keypairSelect.value || null;
        const customScript = qs('customScript')?.value || null;

        if (!imageId || !flavorId || !portId) { showMessage('Image, flavor and port are required', true); return; }
        setLoading(true); showMessage('Creating instance...');
        try {
            const payload = { name, imageId, flavorId, portId };
            if (keypair) payload.key_name = keypair;
            if (customScript) payload.customScript = customScript;

            const r = await fetch('/api/instance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-auth-token': scopedToken, 'x-compute-endpoint': endpoints.compute || '' },
                body: JSON.stringify(payload)
            });
            const j = await r.json();
            if (!r.ok) { showMessage(j.message || 'Failed to create instance', true, j.details || j); return; }
            showMessage('Instance created: ' + (j.instance?.id || j.instance?.server?.id || 'OK'), false, j);
            await refreshInstances();
        } catch (err) { showMessage('Create instance error: ' + err.message, true); }
        finally { setLoading(false); }
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
            if (!res.ok) { showMessage(data.message || 'Failed to create subnet', true, data.details || data); return; }
            showMessage('Subnet created: ' + (data.subnet?.id || data.subnet?.name || 'OK'), false, data);
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
            if (!res.ok) { showMessage(data.message || 'Failed to create port', true, data.details || data); return; }
            const portId = data.port?.id || data.port?.port?.id || '';
            portIdEl.value = portId;
            showMessage('Port created: ' + (portId || 'OK'), false, data);
        } catch (err) { showMessage('Create port error: ' + err.message, true); }
        finally { setLoading(false); }
    }

    // Attach handlers
    testBtn?.addEventListener('click', testConnection);
    loginBtn?.addEventListener('click', login);
    selectProjectBtn?.addEventListener('click', connectProject);

    // Instance create handler (was missing)
    createInstanceBtn?.addEventListener('click', createInstance);

    // Network handlers
    createNetworkBtn?.addEventListener('click', createNetwork);
    createSubnetBtn?.addEventListener('click', createSubnet);
    createPortBtn?.addEventListener('click', createPort);
    refreshNetworksBtn?.addEventListener('click', refreshNetworks);

    // initial state
    setLoading(false);
})();
