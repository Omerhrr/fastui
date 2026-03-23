/**
 * FastUI x-chart Directive
 * Alpine.js directive for ECharts integration
 */

import type { ChartConfig, EChartsInstance } from '../types';
import { generateId, safeParseJSON } from '../utils/helpers';

const chartInstances = new Map<string, EChartsInstance>();
let resizeObserver: ResizeObserver | null = null;

/**
 * Create x-chart Alpine directive
 */
export function createChartDirective() {
  return {
    name: 'chart',

    callback(el: HTMLElement, value: string, effect: () => void): void {
      console.log('[FastUI] x-chart directive called on:', el);
      
      // Parse configuration
      let config: ChartConfig = {};
      const valueStr = typeof value === 'string' ? value : '';
      
      if (valueStr.trim()) {
        const trimmed = valueStr.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          config = safeParseJSON(trimmed, {});
          console.log('[FastUI] Chart config parsed:', config);
        }
      }

      // Set dimensions
      if (!el.style.height) {
        el.style.height = '300px';
      }
      if (!el.style.width) {
        el.style.width = '100%';
      }

      // Initialize chart
      const initChart = () => {
        // Check for ECharts
        if (typeof window.echarts === 'undefined') {
          console.warn('[FastUI] ECharts not loaded, cannot create chart');
          el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999;">ECharts not loaded</div>';
          return;
        }

        try {
          // Dispose existing instance
          const existing = window.echarts.getInstanceByDom(el);
          if (existing) {
            existing.dispose();
          }

          // Create instance
          const instance = window.echarts.init(el);
          const chartId = generateId('chart');
          chartInstances.set(chartId, instance);

          // Extract chart options
          const { lazy, responsive, theme, height, width, dataSource, refreshInterval, ...chartOptions } = config;
          
          // Set options
          instance.setOption(chartOptions as object);
          console.log('[FastUI] Chart created successfully:', chartId);

          // Setup resize
          if (!resizeObserver) {
            resizeObserver = new ResizeObserver((entries) => {
              entries.forEach((entry) => {
                const chartId = (entry.target as HTMLElement).dataset.chartId;
                if (chartId) {
                  chartInstances.get(chartId)?.resize();
                }
              });
            });
          }
          el.dataset.chartId = chartId;
          resizeObserver.observe(el);

        } catch (e) {
          console.error('[FastUI] Failed to create chart:', e);
          el.innerHTML = `<div style="color:red;padding:10px;">Chart error: ${e}</div>`;
        }
      };

      // Initialize after a small delay to ensure DOM is ready
      setTimeout(initChart, 100);
    },
  };
}

/**
 * Update chart data
 */
export function updateChart(chartId: string, options: Record<string, unknown>): void {
  const instance = chartInstances.get(chartId);
  if (instance) {
    instance.setOption(options);
  }
}

/**
 * Get chart instance
 */
export function getChartInstance(chartId: string): EChartsInstance | undefined {
  return chartInstances.get(chartId);
}

/**
 * Dispose chart
 */
export function disposeChart(chartId: string): void {
  const instance = chartInstances.get(chartId);
  if (instance) {
    instance.dispose();
    chartInstances.delete(chartId);
  }
}

/**
 * Resize all charts
 */
export function resizeAllCharts(): void {
  chartInstances.forEach((instance) => instance.resize());
}

// Resize on window resize
if (typeof window !== 'undefined') {
  window.addEventListener('resize', resizeAllCharts);
}
