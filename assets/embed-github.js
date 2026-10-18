/**
 * GitHub profile embed (client-side), rendered as a terminal transcript
 * - Finds elements matching `.github-feed-embed` or `#github-feed-embed`
 * - Reads configuration from data-* attributes with sensible defaults
 * - Shows: languages, top projects (as a tree), and your latest commit (as `git log`)
 *
 * Attributes:
 *   data-github-user   GitHub username (required)
 *   data-projects      how many top projects to show (default 3)
 *   data-exclude       comma-separated repo names to hide, e.g. "my-site,notes"
 *
 * Optional global defaults:
 *   window.GithubFeedWidget = { username: '', projects: 3, exclude: '', cacheMinutes: 30 };
 *
 * Notes:
 * - Uses GitHub's public REST API without a token (60 requests/hour per visitor IP).
 *   Results are cached in localStorage so reloads don't use up that limit.
 * - Only public repositories appear. Forks are ignored.
 */
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
    const BAR_CELLS = 10;

    // Build elements with textContent only, so nothing from the API is ever parsed as HTML
    const el = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    };

    const link = (className, href, text) => {
        const a = el('a', className, text);
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener';
        return a;
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

    // A prompt line: "~$ command  # plain-language note"
    const prompt = (command, note) => {
        const h = el('h3', 'gh-cmd');
        h.setAttribute('aria-label', note);   // screen readers hear the note, not the command
        h.appendChild(el('span', 'gh-prompt', '~$'));
        h.appendChild(document.createTextNode(` ${command}`));
        h.appendChild(el('span', 'gh-comment', `  # ${note}`));
        return h;
    };

    // ---------- Languages: one row per language, text-block bars ----------
    const buildLanguages = (repos) => {
        const section = el('section', 'gh-section');
        section.appendChild(prompt('languages', 'share of repos by main language'));

        const counts = {};
        repos.forEach((r) => { if (r.language) counts[r.language] = (counts[r.language] || 0) + 1; });

        let entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        if (entries.length > MAX_LANGUAGES) {
            const rest = entries.slice(MAX_LANGUAGES - 1).reduce((sum, e) => sum + e[1], 0);
            entries = [...entries.slice(0, MAX_LANGUAGES - 1), ['Other', rest]];
        }
        const total = entries.reduce((sum, e) => sum + e[1], 0);

        if (!total) {
            section.appendChild(el('p', 'gh-empty', 'No languages detected yet.'));
            return section;
        }

        const table = el('table', 'gh-langs');
        const body = el('tbody');
        entries.forEach(([name, n]) => {
            const pct = (n / total) * 100;
            const filled = Math.min(BAR_CELLS, Math.max(1, Math.round((pct / 100) * BAR_CELLS)));

            const tr = el('tr');
            tr.appendChild(el('td', 'gh-lang-name', name));

            const bar = el('td', 'gh-lang-bar');
            bar.setAttribute('aria-hidden', 'true');   // the percentage next to it says the same thing
            bar.appendChild(el('span', 'gh-bar-on', '█'.repeat(filled)));
            bar.appendChild(el('span', 'gh-bar-off', '░'.repeat(BAR_CELLS - filled)));
            tr.appendChild(bar);

            tr.appendChild(el('td', 'gh-lang-pct', `${Math.round(pct)}%`));
            body.appendChild(tr);
        });
        table.appendChild(body);
        section.appendChild(table);
        return section;
    };

    // ---------- Top projects: drawn as a tree ----------
    const buildProjects = (repos, cfg) => {
        const section = el('section', 'gh-section');
        section.appendChild(prompt('tree projects', `top ${cfg.projects} by stars`));

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

        const tree = el('div', 'gh-tree');
        top.forEach((r) => {
            const a = link('gh-project', r.url);
            a.appendChild(el('span', 'gh-project-name', r.name));
            a.appendChild(el('span', 'gh-project-desc', truncate(r.description) || 'No description yet.'));

            const meta = el('span', 'gh-project-meta');
            if (r.language) meta.appendChild(el('span', null, r.language));
            meta.appendChild(el('span', null, `${r.stars} ${r.stars === 1 ? 'star' : 'stars'}`));
            if (r.pushed) meta.appendChild(el('span', null, `updated ${fmtDate(r.pushed)}`));
            a.appendChild(meta);

            tree.appendChild(a);
        });
        section.appendChild(tree);
        return section;
    };

    // ---------- Latest commit: shaped like `git log -1` ----------
    const buildCommit = (commit) => {
        const section = el('section', 'gh-section');
        section.appendChild(prompt('git log -1', 'latest commit'));

        if (!commit) {
            section.appendChild(el('p', 'gh-empty', 'No recent commits to show.'));
            return section;
        }

        const log = el('div', 'gh-log');

        const row = (key, node) => {
            const p = el('p');
            p.appendChild(el('span', 'gh-k', key));
            p.appendChild(node);
            log.appendChild(p);
        };

        row('commit', link('gh-sha', commit.url, commit.sha));
        row('repo', link('gh-repo-link', commit.repoUrl, commit.repo));
        if (commit.date) row('date', document.createTextNode(fmtDate(commit.date)));

        log.appendChild(link('gh-log-msg', commit.url, truncate(commit.message, 120) || '(no message)'));
        section.appendChild(log);
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

        container.replaceChildren(el('p', 'gh-skeleton', 'Loading…'));
        container.setAttribute('aria-busy', 'true');

        try {
            const data = await loadData(cfg);
            const nonProfile = data.repos.filter((r) => r.name.toLowerCase() !== cfg.username.toLowerCase());

            container.replaceChildren(
                buildLanguages(nonProfile),
                buildProjects(data.repos, cfg),
                buildCommit(data.commit)
            );
        } catch (err) {
            console.error('GitHub feed error:', err);
            container.replaceChildren(el('p', 'gh-error', errorMessage(err, cfg.username)));
        } finally {
            container.removeAttribute('aria-busy');
        }
    });
})();
