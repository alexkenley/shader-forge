import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReferenceGuide, ReferenceGuideCategory, ReferenceGuidePage, ReferenceGuideSection } from './reference-guide';

type ReferenceGuideViewProps = {
  guide: ReferenceGuide;
};

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function sectionMatchesQuery(section: ReferenceGuideSection, query: string) {
  if (!query) {
    return true;
  }

  const haystack = normalizeText(
    [section.title, section.note || '', ...(section.keywords || []), ...section.items].join(' '),
  );
  return haystack.includes(query);
}

function filterGuide(guide: ReferenceGuide, rawQuery: string): ReferenceGuide {
  const query = normalizeText(rawQuery);
  if (!query) {
    return guide;
  }

  const categories: ReferenceGuideCategory[] = [];
  for (const category of guide.categories) {
    const categoryMatches = normalizeText(
      [category.title, category.description, ...(category.keywords || [])].join(' '),
    ).includes(query);
    const pages: ReferenceGuidePage[] = [];

    for (const page of category.pages) {
      const pageMatches = normalizeText(
        [
          page.title,
          page.summary,
          ...(page.keywords || []),
          ...(page.references || []),
        ].join(' '),
      ).includes(query);
      const sections = page.sections.filter((section) => sectionMatchesQuery(section, query));

      if (categoryMatches || pageMatches) {
        pages.push(page);
        continue;
      }

      if (sections.length > 0) {
        pages.push({
          ...page,
          sections,
        });
      }
    }

    if (categoryMatches && pages.length === 0) {
      pages.push(...category.pages);
    }

    if (pages.length > 0) {
      categories.push({
        ...category,
        pages,
      });
    }
  }

  return {
    ...guide,
    categories,
  };
}

function countPages(guide: ReferenceGuide) {
  return guide.categories.reduce((total, category) => total + category.pages.length, 0);
}

export function ReferenceGuideView({ guide }: ReferenceGuideViewProps) {
  const [query, setQuery] = useState('');
  const [activePageId, setActivePageId] = useState('');
  const articleRefs = useRef<Record<string, HTMLElement | null>>({});
  const filteredGuide = useMemo(() => filterGuide(guide, query), [guide, query]);
  const pages = useMemo(
    () => filteredGuide.categories.flatMap((category) => category.pages),
    [filteredGuide],
  );

  useEffect(() => {
    if (!pages.length) {
      setActivePageId('');
      return;
    }

    if (!pages.some((page) => page.id === activePageId)) {
      setActivePageId(pages[0].id);
    }
  }, [activePageId, pages]);

  useEffect(() => {
    if (!pages.length || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (visible?.target instanceof HTMLElement) {
          const nextId = visible.target.dataset.guideArticleId || '';
          if (nextId) {
            setActivePageId(nextId);
          }
        }
      },
      {
        root: null,
        rootMargin: '-18% 0px -58% 0px',
        threshold: [0.15, 0.4, 0.7],
      },
    );

    for (const page of pages) {
      const element = articleRefs.current[page.id];
      if (element) {
        observer.observe(element);
      }
    }

    return () => observer.disconnect();
  }, [pages]);

  function focusPage(pageId: string) {
    const article = articleRefs.current[pageId];
    if (!article) {
      return;
    }
    setActivePageId(pageId);
    article.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const filteredPageCount = countPages(filteredGuide);

  return (
    <div className="guide-page">
      <section className="guide-hero">
        <div className="guide-hero__copy">
          <div className="guide-kicker">Engine Wiki</div>
          <h2>{filteredGuide.title}</h2>
          <p>{filteredGuide.intro}</p>
          <div className="guide-hero-meta">
            <div className="guide-meta-block">
              <div className="guide-meta-title">Searchable Sources</div>
              <div className="guide-path-rack">
                {filteredGuide.searchableSources.map((source) => (
                  <span className="guide-path-chip" key={source}>
                    {source}
                  </span>
                ))}
              </div>
            </div>
            <div className="guide-meta-block">
              <div className="guide-meta-title">Assistant Entry Points</div>
              <div className="guide-path-rack">
                {filteredGuide.assistantEntryPoints.map((source) => (
                  <span className="guide-path-chip guide-path-chip--entry" key={source}>
                    {source}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="guide-hero-stats">
          <div className="guide-stat">
            <span className="guide-stat-value">{filteredGuide.categories.length}</span>
            <span className="guide-stat-label">Categories</span>
          </div>
          <div className="guide-stat">
            <span className="guide-stat-value">{filteredPageCount}</span>
            <span className="guide-stat-label">Guides</span>
          </div>
          <div className="guide-stat">
            <span className="guide-stat-value">{filteredGuide.searchableSources.length}</span>
            <span className="guide-stat-label">Search Paths</span>
          </div>
        </div>
      </section>

      <div className="guide-search">
        <label className="guide-search__field">
          <span>Search reference</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search shell surfaces, runtime systems, commands, or docs"
            type="search"
            value={query}
          />
        </label>
        <div className="guide-search__meta">
          {query.trim()
            ? `Filtered to ${filteredGuide.categories.length} categories and ${filteredPageCount} guides`
            : 'Guide content is mirrored in repo-native sources for terminal and future native assistants.'}
        </div>
      </div>

      <div className="guide-wiki">
        <aside className="guide-sidebar">
          <div className="guide-sidebar-inner">
            <div className="guide-sidebar-title">Browse Guides</div>
            {filteredGuide.categories.map((category) => (
              <section className="guide-nav-category" key={category.id}>
                <div className="guide-nav-heading">{category.title}</div>
                <div className="guide-nav-description">{category.description}</div>
                <nav className="guide-nav-links">
                  {category.pages.map((page) => (
                    <button
                      className={`guide-nav-link${activePageId === page.id ? ' active' : ''}`}
                      key={page.id}
                      onClick={() => focusPage(page.id)}
                      type="button"
                    >
                      <span className="guide-nav-link-title">{page.title}</span>
                      <span className="guide-nav-link-summary">{page.summary}</span>
                    </button>
                  ))}
                </nav>
              </section>
            ))}
          </div>
        </aside>

        <main className="guide-content">
          {filteredGuide.categories.length ? (
            filteredGuide.categories.map((category) => (
              <section className="guide-category-block" key={category.id}>
                <div className="guide-category-header">
                  <div className="guide-category-kicker">Category</div>
                  <h3>{category.title}</h3>
                  <p>{category.description}</p>
                </div>

                {category.pages.map((page) => (
                  <article
                    className="guide-article"
                    data-guide-article-id={page.id}
                    key={page.id}
                    ref={(node) => {
                      articleRefs.current[page.id] = node;
                    }}
                  >
                    <header className="guide-article-header">
                      <h4>{page.title}</h4>
                      <p className="guide-page-summary">{page.summary}</p>
                      {page.references?.length ? (
                        <div className="guide-article-references">
                          {page.references.map((reference) => (
                            <span className="guide-path-chip" key={`${page.id}-${reference}`}>
                              {reference}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </header>

                    {page.sections.map((section) => (
                      <section className="guide-section" key={`${page.id}-${section.title}`}>
                        <h5>{section.title}</h5>
                        <ul>
                          {section.items.map((item) => (
                            <li key={`${section.title}-${item}`}>{item}</li>
                          ))}
                        </ul>
                        {section.note ? <div className="guide-note">{section.note}</div> : null}
                      </section>
                    ))}
                  </article>
                ))}
              </section>
            ))
          ) : (
            <section className="guide-empty-state">
              <strong>No guide entries matched.</strong>
              <p>Try a broader term such as `runtime`, `session`, `guide`, `scene`, or `tooling`.</p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
