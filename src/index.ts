/**
 * FastUI - Server-Driven Interactivity for FastStack
 * 
 * @version 0.1.4
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
import {
  loadTailwind,
  loadFlowbite,
  loadECharts,
  loadAlpine,
  loadHTMX,
  loadAllDependencies,
  injectCSS,
  FASTUI_DEFAULT_STYLES,
} from './styles/tailwind';

declare const __VERSION__: string;
declare const __DEV__: boolean;

// Hold directive callbacks before Alpine loads
const pendingDirectives: Map<string, (el: HTMLElement, value: string, effect: () => void) => void> = new Map();

/**
 * Pre-register directive to pending queue (used before Alpine loads)
 */
function preRegisterDirective(name: string, callback: (el: HTMLElement, value: string, effect: () => void) => void): void {
  pendingDirectives.set(name, callback);
  debugLog(`Directive pre-registered: ${name}`);
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

  /**
   * Initialize FastUI
   */
  async function init(): Promise<void> {
    if (initialized) {
      debugLog('FastUI already initialized');
      return;
    }

    debugLog('Initializing FastUI...');

    try {
      // Inject default styles
      injectCSS(FASTUI_DEFAULT_STYLES, 'fastui-default-styles');

      // Pre-register directives BEFORE loading Alpine
      preRegisterDirective('chart', createChartDirective().callback);
      preRegisterDirective('flow', createFlowDirective().callback);
      preRegisterDirective('lazy', createLazyDirective().callback);
      preRegisterDirective('init-fragment', createInitFragmentDirective().callback);

      // Load dependencies (Alpine loads LAST)
      await loadAllDependencies();

      // Wait for Alpine to be ready
      await waitForAlpine();

      // Register pending directives with Alpine
      if (hasAlpine()) {
        registerPendingDirectives();
      }

      // Initialize Alpine store integration
      initAlpineStore();

      // Install HTMX plugin
      const htmxPlugin = createHTMXPlugin();
      htmxPlugin.install(api);
      plugins.set('htmx', htmxPlugin);

      if (typeof window.htmx !== 'undefined') {
        configureHTMXDefaults();
      }

      // Setup cache middleware
      if (config.cacheEnabled) {
        setupCacheMiddleware(cache);
      }

      initialized = true;
      debugLog('FastUI initialized successfully');

      window.dispatchEvent(new CustomEvent('fastui:ready', { detail: { version: __VERSION__ } }));
    } catch (error) {
      console.error('[FastUI] Initialization error:', error);
      throw error;
    }
  }

  /**
   * Wait for Alpine.js to be available
   */
  async function waitForAlpine(timeout = 5000): Promise<void> {
    return new Promise((resolve) => {
      if (hasAlpine()) {
        resolve();
        return;
      }
      const startTime = Date.now();
      const interval = setInterval(() => {
        if (hasAlpine()) {
          clearInterval(interval);
          resolve();
        } else if (Date.now() - startTime > timeout) {
          clearInterval(interval);
          console.warn('[FastUI] Alpine.js not found after timeout');
          resolve();
        }
      }, 50);
    });
  }

  /**
   * Register pending directives with Alpine
   */
  function registerPendingDirectives(): void {
    if (!hasAlpine()) return;
    
    pendingDirectives.forEach((callback, name) => {
      try {
        window.Alpine.directive(name, callback);
        directives.set(name, { name, callback });
        debugLog(`Alpine directive registered: ${name}`);
      } catch (e) {
        console.warn(`[FastUI] Failed to register directive ${name}:`, e);
      }
    });
    pendingDirectives.clear();
  }

  function registerPlugin(name: string, plugin: FastUIPlugin): void {
    if (plugins.has(name)) return;
    plugin.install(api);
    plugins.set(name, plugin);
  }

  function registerDirective(name: string, directive: AlpineDirective): void {
    if (directives.has(name)) return;
    if (hasAlpine()) {
      window.Alpine.directive(name, directive.callback);
    }
    directives.set(name, directive);
  }

  function reinit(el: HTMLElement): void {
    if (hasAlpine()) {
      const alpine = window.Alpine as unknown as { initTree?: (el: HTMLElement) => void };
      el.querySelectorAll('[x-data]').forEach((element) => {
        const htmlEl = element as HTMLElement;
        if (!(htmlEl as unknown as { __x?: unknown }).__x && alpine.initTree) {
          alpine.initTree(htmlEl);
        }
      });
    }
    initFlowbiteComponents(el);
    resizeAllCharts();
  }

  async function lazyLoad(module: string): Promise<void> {
    switch (module) {
      case 'echarts': await loadECharts(); break;
      case 'flowbite': await loadFlowbite(); break;
      case 'tailwind': await loadTailwind(); break;
      case 'alpine': await loadAlpine(); break;
      case 'htmx': await loadHTMX(); break;
    }
  }

  async function createChart(el: HTMLElement, options: EChartsOption): Promise<EChartsInstance> {
    await loadECharts();
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

// Auto-initialize when in browser
if (isBrowser()) {
  const instance = createFastUI();
  window.FastUI = instance;

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
  loadTailwind,
  loadFlowbite,
  loadECharts,
  loadAlpine,
  loadHTMX,
  loadAllDependencies,
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
