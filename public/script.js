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

            // Store endpoints if needed
            // const endpoints = j.endpoints;
            resourceSection.style.display = '';
            showMessage('Connected to project: ' + (j.project?.name || projectId));

        } catch (err) {
            showMessage('Error: ' + err.message, true);
        } finally { setLoading(false); }
    }

    // Attach handlers
    testBtn?.addEventListener('click', testConnection);
    loginBtn?.addEventListener('click', login);
    selectProjectBtn?.addEventListener('click', connectProject);

    // initial state
    setLoading(false);
})();
