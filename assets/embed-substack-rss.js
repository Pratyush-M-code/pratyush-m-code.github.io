/**
 * RSS-based Substack embed (client-side), rendered as a terminal transcript
 * - Finds elements matching `.substack-feed-embed` or `#substack-feed-embed`
 * - Pulls configuration from data-* attributes with sensible defaults
 * - Fetches the Substack RSS (via rss2json) and renders the latest posts as a tree
 *
 * Attributes:
 *   data-substack-url  your Substack address, e.g. "newsletter.safe.ai" (required)
 *   data-posts         how many posts to show (default 3)
 *   data-show-dates    "false" to hide dates
 *   data-show-images   "true" to show each post's first image (off by default)
 *
 * Optional global defaults:
 *   window.SubstackFeedWidget = { substackUrl: '', posts: 3, showImages: false, showDates: true, cacheMinutes: 30 };
 *
 * Results are cached in localStorage so reloads don't hit rss2json's rate limit.
 */
(function () {
    const globalDefaults = (window.SubstackFeedWidget || {});
    const defaults = {
        substackUrl: '',
        posts: 3,
        showImages: false,
        showDates: true,
        cacheMinutes: 30,
        ...globalDefaults
    };

    const containers = document.querySelectorAll('.substack-feed-embed, #substack-feed-embed');
    if (!containers.length) return;

    const STORE_POSTS = 10;   // rss2json returns up to 10; keep them all so a larger data-posts still works from cache

    // Build elements with textContent only, so nothing from the feed is ever parsed as HTML
    const el = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    };

    const fmtDate = (iso) => {
        try {
            // Use reader's locale; tweak if you want a fixed one
            return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: '2-digit' }).format(new Date(iso));
        } catch {
            return '';
        }
    };

    const normalizeUrl = (u) => {
        if (!u) return '';
        return /^https?:\/\//i.test(u) ? u : `https://${u}`;
    };

    const extractFirstImg = (html) => {
        if (!html) return null;
        const m = html.match(/<img[^>]+src="([^"]+)"/i);
        return m && /^https:\/\//i.test(m[1]) ? m[1] : null;
    };

    // Feed descriptions can contain HTML tags and entities; reduce them to plain text safely
    const plainText = (html) => {
        if (!html) return '';
        return (new DOMParser().parseFromString(html, 'text/html').body.textContent || '').trim();
    };

    const truncate = (str, max = 150) => (str && str.length > max ? `${str.slice(0, max)}…` : (str || ''));

    const fetchWithTimeout = (url, ms = 10000) => {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), ms);
        return fetch(url, { signal: ctl.signal }).finally(() => clearTimeout(t));
    };

    const readCache = (key) => {
        try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
    };
    const writeCache = (key, value) => {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked: ignore */ }
    };

    // Fetch the feed, with a cache and a stale-cache fallback
    const loadPosts = async (cfg, feedBase) => {
        const key = `substack-embed:${feedBase.toLowerCase()}`;
        const cached = readCache(key);

        if (cached && Array.isArray(cached.posts) && Date.now() - cached.t < cfg.cacheMinutes * 60000) {
            return cached.posts;
        }

        try {
            const rssUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(`${feedBase}/feed`)}`;
            const res = await fetchWithTimeout(rssUrl, 12000);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            if (data.status !== 'ok' || !Array.isArray(data.items)) {
                throw new Error(data.message || 'Failed to parse feed');
            }

            const posts = data.items
                .filter((p) => /^https?:\/\//i.test(p.link || ''))
                .slice(0, STORE_POSTS)
                .map((p) => ({
                    title: p.title || 'Untitled',
                    link: p.link,
                    pubDate: p.pubDate,
                    description: truncate(plainText(p.description), 160),
                    image: extractFirstImg(p.content)
                }));

            writeCache(key, { t: Date.now(), posts });
            return posts;
        } catch (err) {
            if (cached && Array.isArray(cached.posts)) return cached.posts;   // old data beats an error
            throw err;
        }
    };

    // A prompt line: "~$ command  # plain-language note"
    const prompt = (command, note) => {
        const h = el('h3', 'sub-cmd');
        h.setAttribute('aria-label', note);   // screen readers hear the note, not the command
        h.appendChild(el('span', 'sub-prompt', '~$'));
        h.appendChild(document.createTextNode(` ${command}`));
        h.appendChild(el('span', 'sub-comment', `  # ${note}`));
        return h;
    };

    const buildPost = (post, opts) => {
        const a = el('a', 'sub-post');
        a.target = '_blank';
        a.rel = 'noopener';
        a.href = post.link;

        a.appendChild(el('span', 'sub-title', post.title));

        if (opts.showImages && post.image) {
            const img = document.createElement('img');
            img.className = 'sub-thumb';
            img.loading = 'lazy';
            img.alt = '';                       // decorative: the title already names the post
            img.src = post.image;
            a.appendChild(img);
        }

        if (post.description) a.appendChild(el('span', 'sub-desc', post.description));

        if (opts.showDates && post.pubDate) {
            const date = fmtDate(post.pubDate);
            if (date) a.appendChild(el('span', 'sub-meta', date));
        }
        return a;
    };

    const hostOf = (url) => {
        try { return new URL(url).host; } catch { return url; }
    };

    containers.forEach(async (container) => {
        const cfg = {
            substackUrl: container.getAttribute('data-substack-url') || defaults.substackUrl,
            posts: parseInt(container.getAttribute('data-posts'), 10) || defaults.posts,
            showImages: (container.getAttribute('data-show-images') || `${defaults.showImages}`) === 'true',
            showDates: (container.getAttribute('data-show-dates') || `${defaults.showDates}`) !== 'false',
            cacheMinutes: defaults.cacheMinutes
        };

        if (!cfg.substackUrl) {
            container.replaceChildren(el('p', 'sub-error', 'Error: No Substack URL specified.'));
            return;
        }

        const feedBase = normalizeUrl(cfg.substackUrl).replace(/\/+$/, '');

        container.replaceChildren(el('p', 'sub-skeleton', 'Loading…'));
        container.setAttribute('aria-busy', 'true');

        try {
            const all = await loadPosts(cfg, feedBase);
            const posts = all.slice(0, Math.max(1, cfg.posts));

            const section = el('section', 'sub-section');
            section.appendChild(prompt(`curl ${hostOf(feedBase)}/feed`, 'latest posts'));

            if (!posts.length) {
                section.appendChild(el('p', 'sub-empty', 'No posts available.'));
            } else {
                const tree = el('div', 'sub-tree');
                posts.forEach((post) => tree.appendChild(buildPost(post, cfg)));
                section.appendChild(tree);
            }
            container.replaceChildren(section);
        } catch (err) {
            console.error('Substack feed error:', err);
            container.replaceChildren(el('p', 'sub-error', 'Could not load posts. Please try again later.'));
        } finally {
            container.removeAttribute('aria-busy');
        }
    });
})();
