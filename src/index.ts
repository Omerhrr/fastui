/**
 * FastUI - Server-Driven Interactivity for FastStack
 * 
 * @version 0.1.7
 * @author Omerhrr
 * @license MIT
 */

import type { FastUIAPI, FastUIConfig, FastUIPlugin, AlpineDirective, EChartsOption, EChartsInstance } from './types';
import { mergeConfig, isBrowser, hasAlpine, debugLog } from './utils/helpers';
import { createFragmentCache, setupCacheMiddleware } from './utils/cache';
import { createStore, initAlpineStore } from './utils/store';
import { createChartDirective, updateChart, getChartInstance, disposeChart, resizeAllCharts } from './directives/chart';
import { createFlowDirective, initFlowbiteComponents, cleanupFlowbiteComponents } from './directives/flow';
import { createLazyDirective, createInitFragmentDirective } from './directives/lazy';
import { createHTMXPlugin, configureHTMXDefaults } from './plugins/htmx';
import { injectCSS, FASTUI_DEFAULT_STYLES } from './styles/tailwind';

declare const __VERSION__: string;

const CDN = {
  tailwind: 'https://cdn.tailwindcss.com',
  htmx: 'https://cdn.jsdelivr.net/npm/htmx.org@2.0.8/dist/htmx.min.js',
  echarts: 'https://cdn.jsdelivr.net/npm/echarts@6.0.0/dist/echarts.min.js',
  alpine: 'https://cdn.jsdelivr.net/npm/alpinejs@3.15.8/dist/cdn.min.js',
};

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed: ${src}`));
    document.head.appendChild(script);
  });
}

// Store directive callbacks for manual processing
const directiveCallbacks: Map<string, (el: HTMLElement, value: string, effect: () => void) => void> = new Map();

/**
 * Process elements with a specific directive
 */
function processDirectiveElements(directiveName: string): void {
  const attrName = `x-${directiveName}`;
  const elements = document.querySelectorAll(`[${attrName}]`);
  
  console.log(`[FastUI] Processing ${elements.length} elements with ${attrName}`);
  
  elements.forEach((el) => {
    const htmlEl = el as HTMLElement;
    const value = htmlEl.getAttribute(attrName) || '';
    const callback = directiveCallbacks.get(directiveName);
    
    if (callback) {
      try {
        callback(htmlEl, value, () => {});
      } catch (e) {
        console.error(`[FastUI] Error processing ${attrName}:`, e);
      }
    }
  });
}

/**
 * Create FastUI instance
 */
export function createFastUI(userConfig?: Partial<FastUIConfig>): FastUIAPI {
  const config = mergeConfig(userConfig);
  const store = createStore();
  const cache = createFragmentCache(config.cacheTTL);
  const plugins = new Map<string, FastUIPlugin>();
  const directives = new Map<string, AlpineDirective>();
  let initialized = false;

  async function init(): Promise<void> {
    if (initialized) return;
    
    console.log('[FastUI] Starting initialization...');
    
    try {
      // 1. Inject styles
      injectCSS(FASTUI_DEFAULT_STYLES, 'fastui-default-styles');
      
      // 2. Prepare directive callbacks
      const chartDirective = createChartDirective();
      const flowDirective = createFlowDirective();
      const lazyDirective = createLazyDirective();
      const fragmentDirective = createInitFragmentDirective();
      
      directiveCallbacks.set('chart', chartDirective.callback);
      directiveCallbacks.set('flow', flowDirective.callback);
      directiveCallbacks.set('lazy', lazyDirective.callback);
      directiveCallbacks.set('init-fragment', fragmentDirective.callback);
      
      // 3. Load Tailwind
      console.log('[FastUI] Loading Tailwind...');
      await loadScript(CDN.tailwind).catch(() => {});
      console.log('[FastUI] Tailwind loaded');
      
      // 4. Load ECharts (MUST be before Alpine processes charts)
      console.log('[FastUI] Loading ECharts...');
      await loadScript(CDN.echarts).catch(() => {});
      console.log('[FastUI] ECharts loaded:', typeof window.echarts !== 'undefined');
      
      // 5. Load HTMX
      console.log('[FastUI] Loading HTMX...');
      await loadScript(CDN.htmx).catch(() => {});
      console.log('[FastUI] HTMX loaded');
      
      // 6. Process x-chart elements BEFORE Alpine loads
      // This ensures charts are created before Alpine tries to process them
      processDirectiveElements('chart');
      processDirectiveElements('lazy');
      
      // 7. Load Alpine
      console.log('[FastUI] Loading Alpine...');
      await loadScript(CDN.alpine).catch(() => {});
      console.log('[FastUI] Alpine loaded:', typeof window.Alpine !== 'undefined');
      
      // 8. Register directives with Alpine for future elements (HTMX swaps)
      if (typeof window.Alpine !== 'undefined') {
        window.Alpine.directive('chart', chartDirective.callback);
        window.Alpine.directive('flow', flowDirective.callback);
        window.Alpine.directive('lazy', lazyDirective.callback);
        window.Alpine.directive('init-fragment', fragmentDirective.callback);
        console.log('[FastUI] Directives registered with Alpine');
      }
      
      // 9. Initialize store
      initAlpineStore();
      
      // 10. Setup HTMX plugin
      if (typeof window.htmx !== 'undefined') {
        const htmxPlugin = createHTMXPlugin();
        htmxPlugin.install(api);
        plugins.set('htmx', htmxPlugin);
        configureHTMXDefaults();
      }
      
      if (config.cacheEnabled) {
        setupCacheMiddleware(cache);
      }
      
      initialized = true;
      console.log('[FastUI] ✅ Initialization complete');
      
      window.dispatchEvent(new CustomEvent('fastui:ready', { detail: { version: __VERSION__ } }));
    } catch (error) {
      console.error('[FastUI] Initialization error:', error);
      throw error;
    }
  }

  function registerPlugin(name: string, plugin: FastUIPlugin): void {
    if (plugins.has(name)) return;
    plugin.install(api);
    plugins.set(name, plugin);
  }

  function registerDirective(name: string, directive: AlpineDirective): void {
    if (directives.has(name)) return;
    directiveCallbacks.set(name, directive.callback);
    if (typeof window.Alpine !== 'undefined') {
      window.Alpine.directive(name, directive.callback);
    }
    directives.set(name, directive);
  }

  function reinit(el: HTMLElement): void {
    // Re-process directives
    directiveCallbacks.forEach((callback, name) => {
      const elements = el.querySelectorAll(`[x-${name}]`);
      elements.forEach((element) => {
        const htmlEl = element as HTMLElement;
        const value = htmlEl.getAttribute(`x-${name}`) || '';
        callback(htmlEl, value, () => {});
      });
    });
    
    // Reinit Alpine
    if (typeof window.Alpine !== 'undefined' && (window.Alpine as any).initTree) {
      el.querySelectorAll('[x-data]').forEach((element) => {
        const htmlEl = element as HTMLElement;
        if (!(htmlEl as any).__x) {
          (window.Alpine as any).initTree(htmlEl);
        }
      });
    }
    
    initFlowbiteComponents(el);
    resizeAllCharts();
  }

  async function lazyLoad(module: string): Promise<void> {
    switch (module) {
      case 'echarts': await loadScript(CDN.echarts); break;
      case 'htmx': await loadScript(CDN.htmx); break;
    }
  }

  async function createChart(el: HTMLElement, options: EChartsOption): Promise<EChartsInstance> {
    if (typeof window.echarts === 'undefined') {
      await loadScript(CDN.echarts);
    }
    if (typeof window.echarts === 'undefined') {
      throw new Error('[FastUI] ECharts not loaded');
    }
    const instance = window.echarts.init(el);
    instance.setOption(options);
    return instance;
  }

  const api: FastUIAPI = {
    version: __VERSION__,
    debug: config.debug || false,
    store,
    cache,
    plugins,
    directives,
    init,
    registerPlugin,
    registerDirective,
    reinit,
    lazyLoad,
    createChart,
    initFlowbite: (el: HTMLElement) => initFlowbiteComponents(el),
  };

  return api;
}

// Auto-initialize
if (isBrowser()) {
  const instance = createFastUI();
  (window as any).FastUI = instance;

  const autoInit = () => {
    instance.init().catch((error) => {
      console.error('[FastUI] Auto-init failed:', error);
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    setTimeout(autoInit, 0);
  }
}

export {
  createChartDirective,
  createFlowDirective,
  createLazyDirective,
  createHTMXPlugin,
  createFragmentCache,
  createStore,
  updateChart,
  getChartInstance,
  disposeChart,
  resizeAllCharts,
  initFlowbiteComponents,
  cleanupFlowbiteComponents,
  injectCSS,
  FASTUI_DEFAULT_STYLES,
};

export type {
  FastUIAPI,
  FastUIConfig,
  FastUIPlugin,
  AlpineDirective,
  ChartConfig,
  EChartsOption,
  EChartsInstance,
  FlowbiteComponentType,
  LazyLoadOptions,
  CachedFragment,
} from './types';
