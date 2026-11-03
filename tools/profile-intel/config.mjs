// Shared settings for the profile-intel pipeline. Everything that decides what
// counts as evidence lives here, so a reviewer can read the rules in one place.

export const CONFIG = Object.freeze({
  login: 'kpdagrt22',
  profileRepo: 'kpdagrt22/kpdagrt22',
  baseBranch: 'main',
  branch: 'auto/profile-intel',
  manifestPath: 'data/projects.manifest.json',
  readmePath: 'README.md',

  // thisiskp.in (Astro). Publishing there is OFF until the site reads this file.
  portfolioRepo: 'kpdagrt22/thisiskp',
  portfolioTargetPath: 'src/data/recent-work.json',

  // The profile repository itself is never a project: the pipeline's own pull
  // requests land there and would otherwise count as "activity".
  excludeRepos: ['kpdagrt22/kpdagrt22'],
  // Excluded by numeric id, so their names are not repeated here: two private
  // snapshot copies of company repositories (the README's measurement method
  // excludes them too; the real projects are manual RVM CAD entries).
  excludeRepoIds: [1389863107, 1209242537],
  // Company organisations. Their work stays in the README's manual entries
  // (copied verbatim); merged pull requests there are counted in the report
  // but never read or published, even where a repository is public.
  companyOrgs: ['RVM-BEYOND-PRIVATE-LIMITED'],

  // Pull request flow: open a PR, validate, then merge it when GitHub reports
  // it clean. Kill switch: repository variable PROFILE_INTEL_AUTOMERGE=false.
  mergePollMs: 5_000,
  mergeWaitMs: 5 * 60 * 1000,

  // When the manifest has not changed for longer than the window (a failed
  // run, a pull request left open), look back to its last change, at most
  // this many days.
  maxCatchUpDays: 35,

  // Rendering
  latestMaxEntries: 6,
  activeWindowDays: 90,
  latestExcludeCategories: ['learning', 'case-study'],
  summaryMaxChars: 200,
  technologiesPerLine: 6,

  // Manifest
  maxEvidencePerEntry: 12,

  // Classification thresholds
  docsSubstantialLines: 300, // a docs-only change this large counts as meaningful
  minCodeLines: 3, // smaller code changes are "trivial"

  // API budget (keeps a weekly run well inside the 20-minute job timeout)
  commitDetailCapPerRepo: 100,
  commitDetailCapTotal: 400,
  prFilesCap: 300,
  sourceFilesPerRepo: 80,
  sourceFileMaxBytes: 300_000,

  // Technology evidence
  languageMinShare: 0.03,
  languageMinBytes: 5_000,
  newRepoMinCodeBytes: 2_000,
});

// Logins and names that are automation, never KP's own work.
export const BOT_LOGINS = new Set([
  'dependabot',
  'dependabot-preview',
  'renovate',
  'renovate-bot',
  'github-actions',
  'snyk-bot',
  'imgbot',
  'allcontributors',
  'pre-commit-ci',
  'mergify',
  'codecov',
]);

export const LOCKFILE_RE =
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|poetry\.lock|Pipfile\.lock|uv\.lock|pdm\.lock|Cargo\.lock|go\.sum|composer\.lock|Gemfile\.lock|pubspec\.lock|packages\.lock\.json)$/;

export const GENERATED_RE = new RegExp(
  [
    String.raw`(^|/)(dist|build|out|\.next|\.nuxt|\.svelte-kit|\.astro|coverage|node_modules|__generated__|generated|\.turbo|\.vercel)/`,
    String.raw`\.min\.(js|css)$`,
    String.raw`\.map$`,
    String.raw`\.snap$`,
    String.raw`(^|/)src/data/recent-work\.json$`,
  ].join('|'),
);

export const DOCS_RE =
  /(^|\/)(docs?|documentation)\/|\.(md|mdx|markdown|rst|adoc|txt)$|(^|\/)(LICEN[CS]E|NOTICE|AUTHORS|CODEOWNERS|CHANGELOG)(\.[a-z]+)?$/i;

// Languages GitHub reports that are build glue or markup, not a stack choice.
export const LANGUAGE_IGNORE = new Set([
  'Dockerfile',
  'Makefile',
  'Procfile',
  'Batchfile',
  'PowerShell',
  'Shell',
  'CMake',
  'Roff',
  'HTML',
  'CSS',
  'SCSS',
  'Sass',
  'Less',
  'Jinja',
  'Mako',
  'Nix',
  'Smarty',
  'Handlebars',
  'EJS',
  'Jupyter Notebook',
  'MDX',
  'Markdown',
  'TeX',
]);

const JS = /\.(m?js|cjs|jsx|ts|tsx|mts|cts|vue|svelte|astro)$/;
const PY = /\.py$/;
const CSS = /\.(css|scss|sass|pcss)$/;

const imp = (name) => {
  const n = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return new RegExp(`(from\\s+['"]${n}(/[^'"]*)?['"]|require\\(\\s*['"]${n}(/[^'"]*)?['"]\\s*\\)|import\\(\\s*['"]${n}(/[^'"]*)?['"]\\s*\\)|import\\s+['"]${n}(/[^'"]*)?['"])`);
};
const pyImp = (mod) => new RegExp(`^\\s*(from\\s+${mod}(\\.[\\w.]+)?\\s+import\\b|import\\s+${mod}\\b)`, 'm');

// Frameworks and notable libraries. A technology is recorded only when it is
// declared in a dependency manifest AND used: imported from source, or wired in
// through its own config file. An unused dependency never counts.
export const FRAMEWORKS = [
  // npm
  { eco: 'npm', dep: 'next', name: 'Next.js', files: JS, use: imp('next'), config: /(^|\/)next\.config\.(js|mjs|cjs|ts|mts)$/ },
  { eco: 'npm', dep: 'react', name: 'React', files: JS, use: imp('react') },
  { eco: 'npm', dep: 'astro', name: 'Astro', files: JS, use: imp('astro'), config: /(^|\/)astro\.config\.(js|mjs|cjs|ts|mts)$/, ext: /\.astro$/ },
  { eco: 'npm', dep: 'vue', name: 'Vue', files: JS, use: imp('vue'), ext: /\.vue$/ },
  { eco: 'npm', dep: 'svelte', name: 'Svelte', files: JS, use: imp('svelte'), ext: /\.svelte$/ },
  { eco: 'npm', dep: '@angular/core', name: 'Angular', files: JS, use: imp('@angular/core') },
  { eco: 'npm', dep: 'express', name: 'Express', files: JS, use: imp('express') },
  { eco: 'npm', dep: '@nestjs/core', name: 'NestJS', files: JS, use: /from\s+['"]@nestjs\/[\w-]+['"]/ },
  { eco: 'npm', dep: 'fastify', name: 'Fastify', files: JS, use: imp('fastify') },
  { eco: 'npm', dep: 'hono', name: 'Hono', files: JS, use: imp('hono') },
  { eco: 'npm', dep: 'tailwindcss', name: 'Tailwind CSS', files: CSS, use: /@import\s+['"]tailwindcss['"]|@tailwind\s+(base|components|utilities)/, config: /(^|\/)tailwind\.config\.(js|mjs|cjs|ts)$/ },
  { eco: 'npm', dep: 'vite', name: 'Vite', files: JS, use: imp('vite'), config: /(^|\/)vite\.config\.(js|mjs|cjs|ts|mts)$/ },
  { eco: 'npm', dep: 'three', name: 'three.js', files: JS, use: imp('three') },
  { eco: 'npm', dep: '@react-three/fiber', name: 'React Three Fiber', files: JS, use: imp('@react-three/fiber') },
  { eco: 'npm', dep: '@tanstack/react-query', name: 'TanStack Query', files: JS, use: imp('@tanstack/react-query') },
  { eco: 'npm', dep: 'zod', name: 'Zod', files: JS, use: imp('zod') },
  { eco: 'npm', dep: 'drizzle-orm', name: 'Drizzle ORM', files: JS, use: imp('drizzle-orm') },
  { eco: 'npm', dep: '@prisma/client', name: 'Prisma', files: JS, use: imp('@prisma/client'), config: /(^|\/)schema\.prisma$/ },
  { eco: 'npm', dep: '@supabase/supabase-js', name: 'Supabase', files: JS, use: imp('@supabase/supabase-js') },
  { eco: 'npm', dep: 'vitest', name: 'Vitest', files: JS, use: imp('vitest'), config: /(^|\/)vitest\.(config|workspace)\.(js|mjs|cjs|ts|mts)$/ },
  { eco: 'npm', dep: 'jest', name: 'Jest', files: JS, use: imp('@jest/globals'), config: /(^|\/)jest\.config\.(js|mjs|cjs|ts|json)$/ },
  { eco: 'npm', dep: '@playwright/test', name: 'Playwright', files: JS, use: imp('@playwright/test'), config: /(^|\/)playwright\.config\.(js|mjs|cjs|ts)$/ },
  { eco: 'npm', dep: 'razorpay', name: 'Razorpay', files: JS, use: imp('razorpay') },
  { eco: 'npm', dep: '@modelcontextprotocol/sdk', name: 'MCP', files: JS, use: imp('@modelcontextprotocol/sdk') },
  { eco: 'npm', dep: '@anthropic-ai/sdk', name: 'Claude API', files: JS, use: imp('@anthropic-ai/sdk') },
  { eco: 'npm', dep: '@google/genai', name: 'Gemini API', files: JS, use: imp('@google/genai') },
  { eco: 'npm', dep: '@google/generative-ai', name: 'Gemini API', files: JS, use: imp('@google/generative-ai') },
  { eco: 'npm', dep: 'openai', name: 'OpenAI API', files: JS, use: imp('openai') },
  { eco: 'npm', dep: 'electron', name: 'Electron', files: JS, use: imp('electron') },
  { eco: 'npm', dep: 'react-native', name: 'React Native', files: JS, use: imp('react-native') },
  // Python
  { eco: 'py', dep: 'fastapi', name: 'FastAPI', files: PY, use: pyImp('fastapi') },
  { eco: 'py', dep: 'flask', name: 'Flask', files: PY, use: pyImp('flask') },
  { eco: 'py', dep: 'django', name: 'Django', files: PY, use: pyImp('django') },
  { eco: 'py', dep: 'pandas', name: 'pandas', files: PY, use: pyImp('pandas') },
  { eco: 'py', dep: 'scikit-learn', name: 'scikit-learn', files: PY, use: pyImp('sklearn') },
  { eco: 'py', dep: 'pyarrow', name: 'PyArrow', files: PY, use: pyImp('pyarrow') },
  { eco: 'py', dep: 'pyswisseph', name: 'Swiss Ephemeris', files: PY, use: pyImp('swisseph') },
  { eco: 'py', dep: 'pydantic', name: 'Pydantic', files: PY, use: pyImp('pydantic') },
  { eco: 'py', dep: 'sqlalchemy', name: 'SQLAlchemy', files: PY, use: pyImp('sqlalchemy') },
  { eco: 'py', dep: 'pytest', name: 'pytest', files: PY, use: pyImp('pytest'), config: /(^|\/)(conftest\.py|pytest\.ini)$/ },
  { eco: 'py', dep: 'torch', name: 'PyTorch', files: PY, use: pyImp('torch') },
  { eco: 'py', dep: 'tensorflow', name: 'TensorFlow', files: PY, use: pyImp('tensorflow') },
  { eco: 'py', dep: 'transformers', name: 'Hugging Face Transformers', files: PY, use: pyImp('transformers') },
  { eco: 'py', dep: 'langchain', name: 'LangChain', files: PY, use: pyImp('langchain') },
  { eco: 'py', dep: 'llama-index', name: 'LlamaIndex', files: PY, use: pyImp('llama_index') },
  { eco: 'py', dep: 'streamlit', name: 'Streamlit', files: PY, use: pyImp('streamlit') },
  { eco: 'py', dep: 'pyspark', name: 'PySpark', files: PY, use: pyImp('pyspark') },
  { eco: 'py', dep: 'mlflow', name: 'MLflow', files: PY, use: pyImp('mlflow') },
  { eco: 'py', dep: 'xgboost', name: 'XGBoost', files: PY, use: pyImp('xgboost') },
  { eco: 'py', dep: 'anthropic', name: 'Claude API', files: PY, use: pyImp('anthropic') },
  { eco: 'py', dep: 'openai', name: 'OpenAI API', files: PY, use: pyImp('openai') },
  { eco: 'py', dep: 'google-genai', name: 'Gemini API', files: PY, use: /^\s*from\s+google\s+import\s+genai\b|^\s*import\s+google\.genai\b/m },
  { eco: 'py', dep: 'google-generativeai', name: 'Gemini API', files: PY, use: /^\s*import\s+google\.generativeai\b|^\s*from\s+google\.generativeai\b|^\s*from\s+google\s+import\s+generativeai\b/m },
];

export const SOURCE_SKIP_RE =
  /(^|\/)(node_modules|dist|build|out|\.next|\.nuxt|\.astro|coverage|vendor|venv|\.venv|env|site-packages|__pycache__|\.git|\.turbo|public|static|fixtures?|__snapshots__)\//;
