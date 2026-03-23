/**
 * FastUI - Server-Driven Interactivity for FastStack
 * 
 * @version 0.1.5
 * @author Omerhrr
 * @license MIT
 */

import type { FastUIAPI, FastUIConfig, FastUIPlugin, AlpineDirective, EChartsOption, EChartsInstance } from './types';
import { mergeConfig, isBrowser, hasAlpine, debugLog, loadScript } from './utils/helpers';
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
  loadHTMX,
  injectCSS,
  FASTUI_DEFAULT_STYLES,
} from './styles/tailwind';

declare const __VERSION__: string;
declare const __DEV__: boolean;

// Store directives to register when Alpine loads
const directiveCallbacks: Map<string, (el: HTMLElement, value: string, effect: () => void) => void> = new Map();

/**
 * Set up Alpine defer loading to register directives before Alpine starts
 */
function setupAlpineDefer(): void {
  if (typeof window === 'undefined') return;
  
  // Check if Alpine is already loaded
  if (hasAlpine()) {
    registerDirectivesWithAlpine();
    return;
  }

  // Set up defer callback - Alpine CDN calls this before starting
  (window as unknown as { deferLoadingAlpine?: (callback: () => void) => void }).deferLoadingAlpine = (callback: () => void) => {
    debugLog('Alpine deferLoadingAlpine called');
    registerDirectivesWithAlpine();
    callback();
  };
}

/**
 * Register all directives with Alpine
 */
function registerDirectivesWithAlpine(): void {
  if (!hasAlpine()) return;
  
  debugLog('Registering directives with Alpine...');
  
  // Register x-chart
  const chartDirective = createChartDirective();
  window.Alpine.directive(chartDirective.name, chartDirective.callback);
  directiveCallbacks.set(chartDirective.name, chartDirective.callback);
  
  // Register x-flow
  const flowDirective = createFlowDirective();
  window.Alpine.directive(flowDirective.name, flowDirective.callback);
  directiveCallbacks.set(flowDirective.name, flowDirective.callback);
  
  // Register x-lazy
  const lazyDirective = createLazyDirective();
  window.Alpine.directive(lazyDirective.name, lazyDirective.callback);
  directiveCallbacks.set(lazyDirective.name, lazyDirective.callback);
  
  // Register x-init-fragment
  const initFragmentDirective = createInitFragmentDirective();
  window.Alpine.directive(initFragmentDirective.name, initFragmentDirective.callback);
  directiveCallbacks.set(initFragmentDirective.name, initFragmentDirective.callback);

  debugLog('All directives registered with Alpine');
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

      // Set up Alpine defer BEFORE loading Alpine
      setupAlpineDefer();

      // Load Tailwind and HTMX first
      await Promise.all([
        loadTailwind(),
        loadHTMX(),
      ]);

      // Load optional deps
      await Promise.all([
        loadECharts().catch(() => debugLog('ECharts optional')),
        loadFlowbite().catch(() => debugLog('Flowbite optional')),
      ]);

      // Load Alpine.js (will call deferLoadingAlpine before starting)
      await loadAlpineScript();

      // If Alpine was already loaded, register now
      if (hasAlpine() && directiveCallbacks.size === 0) {
        registerDirectivesWithAlpine();
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

/**
 * Load Alpine.js script with defer support
 */
async function loadAlpineScript(): Promise<void> {
  if (typeof window.Alpine !== 'undefined') {
    debugLog('Alpine already loaded');
    return;
  }

  const ALPINE_CDN = 'https://cdn.jsdelivr.net/npm/alpinejs@3.13.3/dist/cdn.min.js';
  
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = ALPINE_CDN;
    script.async = true;
    script.onload = () => {
      debugLog('Alpine.js loaded');
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load Alpine.js'));
    document.head.appendChild(script);
  });
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
  loadHTMX,
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
