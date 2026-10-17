(function () {
    const globalDefaults = (window.GithubFeedWidget || {});
    const defaults = {
        username: '',
        projects: 3,
        exclude: '',
        cacheMinutes: 30,
        ...globalDefaults
    };

    const containers = document.querySelectorAll('.github-feed-embed, #github-feed-embed');
    if (!containers.length) return;

    const API = 'https://api.github.com';
    const MAX_LANGUAGES = 6;

    // GitHub's own language colours for the common ones; anything else falls back to your accent
    const LANG_COLORS = {
        JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', HTML: '#e34c26',
        CSS: '#663399', Java: '#b07219', 'C++': '#f34b7d', C: '#8a8a8a', 'C#': '#178600',
        Go: '#00ADD8', Rust: '#dea584', Ruby: '#701516', PHP: '#4F5D95', Swift: '#F05138',
        Kotlin: '#A97BFF', Shell: '#89e051', Jupyter: '#DA5B0B', 'Jupyter Notebook': '#DA5B0B',
        Julia: '#a270ba', R: '#198CE7', MATLAB: '#e16737', Lua: '#000080', Dart: '#00B4AB',
        Other: '#6d6d6d'
    };
    const FALLBACK_COLOR = '#C89A5A';

    // Build elements with textContent only, so nothing from the API is ever parsed as HTML
    const el = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    };

    const fmtDate = (iso) => {
        try {
            return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: '2-digit' }).format(new Date(iso));
        } catch {
            return '';
        }
    };

    const truncate = (str, max = 110) => (str && str.length > max ? `${str.slice(0, max)}…` : (str || ''));

    const fetchJSON = async (url, ms = 10000) => {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), ms);
        try {
            const res = await fetch(url, {
                signal: ctl.signal,
                headers: { Accept: 'application/vnd.github+json' }
            });
            if (!res.ok) {
                const err = new Error(`HTTP ${res.status}`);
                err.status = res.status;
                throw err;
            }
            return await res.json();
        } finally {
            clearTimeout(t);
        }
    };

    const readCache = (key) => {
        try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
    };
    const writeCache = (key, value) => {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked: ignore */ }
    };

    // Fetch repos + the newest commit, with a cache and a stale-cache fallback
    const loadData = async (cfg) => {
        const user = encodeURIComponent(cfg.username);
        const key = `gh-embed:${cfg.username.toLowerCase()}`;
        const cached = readCache(key);

        if (cached && Date.now() - cached.t < cfg.cacheMinutes * 60000) return cached.data;

        try {
            const repos = await fetchJSON(`${API}/users/${user}/repos?type=owner&sort=pushed&per_page=100`);
            const own = repos.filter((r) => !r.fork);

            // Latest commit: newest commit of the most recently pushed repo
            let commit = null;
            if (own[0]) {
                try {
                    const list = await fetchJSON(`${API}/repos/${user}/${encodeURIComponent(own[0].name)}/commits?per_page=1`);
                    if (list[0]) {
                        commit = {
                            sha: list[0].sha.slice(0, 7),
                            url: list[0].html_url,
                            message: (list[0].commit.message || '').split('\n')[0],
                            date: list[0].commit.author && list[0].commit.author.date,
                            repo: own[0].name,
                            repoUrl: own[0].html_url
                        };
                    }
                } catch {
                    // Empty repo (409) or a failed request: show everything else without a commit
                }
            }

            const data = {
                commit,
                repos: own.map((r) => ({
                    name: r.name,
                    url: r.html_url,
                    description: r.description,
                    stars: r.stargazers_count,
                    forks: r.forks_count,
                    language: r.language,
                    pushed: r.pushed_at
                }))
            };
            writeCache(key, { t: Date.now(), data });
            return data;
        } catch (err) {
            if (cached) return cached.data;   // rate-limited or offline: old data beats an error
            throw err;
        }
    };

    // ---------- Languages card ----------
    const buildLanguages = (repos) => {
        const counts = {};
        repos.forEach((r) => { if (r.language) counts[r.language] = (counts[r.language] || 0) + 1; });

        let entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        if (entries.length > MAX_LANGUAGES) {
            const rest = entries.slice(MAX_LANGUAGES - 1).reduce((sum, e) => sum + e[1], 0);
            entries = [...entries.slice(0, MAX_LANGUAGES - 1), ['Other', rest]];
        }
        const total = entries.reduce((sum, e) => sum + e[1], 0);

        const card = el('section', 'gh-card gh-languages');
        card.appendChild(el('h3', 'gh-heading', 'Languages'));

        if (!total) {
            card.appendChild(el('p', 'gh-empty', 'No languages detected yet.'));
            return card;
        }

        const shares = entries.map(([name, n]) => ({ name, pct: (n / total) * 100 }));

        const bar = el('div', 'gh-lang-bar');
        bar.setAttribute('role', 'img');
        bar.setAttribute('aria-label', 'Languages by repository: ' + shares.map((s) => `${s.name} ${Math.round(s.pct)}%`).join(', '));
        shares.forEach((s) => {
            const seg = el('span', 'gh-lang-seg');
            seg.style.width = `${s.pct}%`;
            seg.style.background = LANG_COLORS[s.name] || FALLBACK_COLOR;
            bar.appendChild(seg);
        });
        card.appendChild(bar);

        const legend = el('ul', 'gh-lang-legend');
        shares.forEach((s) => {
            const li = el('li');
            const dot = el('span', 'gh-dot');
            dot.style.background = LANG_COLORS[s.name] || FALLBACK_COLOR;
            li.appendChild(dot);
            li.appendChild(el('span', 'gh-lang-name', s.name));
            li.appendChild(el('span', 'gh-lang-pct', `${s.pct.toFixed(s.pct < 10 ? 1 : 0)}%`));
            legend.appendChild(li);
        });
        card.appendChild(legend);
        return card;
    };

    // ---------- Top projects ----------
    const buildProjects = (repos, cfg) => {
        const section = el('section', 'gh-projects');
        section.appendChild(el('h3', 'gh-heading', 'Top projects'));

        const hidden = new Set(
            cfg.exclude.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
        );
        hidden.add(cfg.username.toLowerCase());   // your profile README repo isn't a project

        const top = repos
            .filter((r) => !hidden.has(r.name.toLowerCase()))
            .sort((a, b) => (b.stars - a.stars) || (new Date(b.pushed) - new Date(a.pushed)))
            .slice(0, Math.max(1, cfg.projects));

        if (!top.length) {
            section.appendChild(el('p', 'gh-empty', 'No public projects yet.'));
            return section;
        }

        const list = el('div', 'gh-project-list');
        top.forEach((r) => {
            const a = el('a', 'gh-project');
            a.href = r.url;
            a.target = '_blank';
            a.rel = 'noopener';

            a.appendChild(el('h4', 'gh-project-name', r.name));
            a.appendChild(el('p', 'gh-project-desc', truncate(r.description) || 'No description yet.'));

            const meta = el('div', 'gh-meta');
            if (r.language) {
                const lang = el('span', 'gh-meta-item');
                const dot = el('span', 'gh-dot');
                dot.style.background = LANG_COLORS[r.language] || FALLBACK_COLOR;
                lang.appendChild(dot);
                lang.appendChild(document.createTextNode(r.language));
                meta.appendChild(lang);
            }
            meta.appendChild(el('span', 'gh-meta-item', `${r.stars} ${r.stars === 1 ? 'star' : 'stars'}`));
            meta.appendChild(el('span', 'gh-meta-item', `${r.forks} ${r.forks === 1 ? 'fork' : 'forks'}`));
            if (r.pushed) meta.appendChild(el('span', 'gh-meta-item', `Updated ${fmtDate(r.pushed)}`));
            a.appendChild(meta);

            list.appendChild(a);
        });
        section.appendChild(list);
        return section;
    };

    // ---------- Latest commit (styled like a `git log` line) ----------
    const buildCommit = (commit) => {
        const section = el('section', 'gh-commit');
        section.appendChild(el('h3', 'gh-heading', 'Latest commit'));

        if (!commit) {
            section.appendChild(el('p', 'gh-empty', 'No recent commits to show.'));
            return section;
        }

        const line = el('a', 'gh-commit-line');
        line.href = commit.url;
        line.target = '_blank';
        line.rel = 'noopener';
        line.appendChild(el('span', 'gh-sha', commit.sha));
        line.appendChild(el('span', 'gh-commit-msg', truncate(commit.message, 120) || '(no message)'));
        section.appendChild(line);

        const info = el('p', 'gh-commit-info');
        const repoLink = el('a', 'gh-repo-link', commit.repo);
        repoLink.href = commit.repoUrl;
        repoLink.target = '_blank';
        repoLink.rel = 'noopener';
        info.appendChild(document.createTextNode('in '));
        info.appendChild(repoLink);
        if (commit.date) info.appendChild(document.createTextNode(` on ${fmtDate(commit.date)}`));
        section.appendChild(info);
        return section;
    };

    const errorMessage = (err, user) => {
        if (err && (err.status === 403 || err.status === 429)) {
            return 'GitHub is limiting requests from your connection right now. Try again in an hour.';
        }
        if (err && err.status === 404) return `No GitHub user named "${user}" was found.`;
        return 'Could not load GitHub data. Please try again later.';
    };

    containers.forEach(async (container) => {
        const cfg = {
            username: container.getAttribute('data-github-user') || defaults.username,
            projects: parseInt(container.getAttribute('data-projects'), 10) || defaults.projects,
            exclude: container.getAttribute('data-exclude') || defaults.exclude,
            cacheMinutes: defaults.cacheMinutes
        };

        if (!cfg.username) {
            container.replaceChildren(el('p', 'gh-error', 'Error: No GitHub username specified.'));
            return;
        }

        container.replaceChildren(el('div', 'gh-skeleton', 'Loading…'));
        container.setAttribute('aria-busy', 'true');

        try {
            const data = await loadData(cfg);

            const top = el('div', 'gh-top');
            top.appendChild(buildLanguages(data.repos.filter((r) => r.name.toLowerCase() !== cfg.username.toLowerCase())));
            top.appendChild(buildCommit(data.commit));

            container.replaceChildren(top, buildProjects(data.repos, cfg));
        } catch (err) {
            console.error('GitHub feed error:', err);
            container.replaceChildren(el('p', 'gh-error', errorMessage(err, cfg.username)));
        } finally {
            container.removeAttribute('aria-busy');
        }
    });
})();
