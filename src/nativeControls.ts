import { useEffect, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import './nativeControls.css';

export interface NativeNavigation {
  title: string;
  avatarColor?: 'white' | 'violet' | 'green' | 'orange' | 'blue' | 'pink';
  group?: boolean;
  subtitle?: string;
  backLabel?: string;
  backVisible: boolean;
  detailsVisible: boolean;
  detailsLabel?: string;
  selectedSurface?: 'chat' | 'computer';
  computerVisible?: boolean;
  settingsVisible?: boolean;
}
export interface NativeComposer {
  focusRequest?: number;
  draft: string;
  placeholder: string;
  disabled: boolean;
  submitDisabled: boolean;
  submitLabel: string;
  stopVisible: boolean;
  stopDisabled: boolean;
  stopLabel?: string;
  attachmentVisible?: boolean;
  attachmentDisabled?: boolean;
  attachmentLabel?: string;
}
interface Options {
  enabled: boolean;
  scopeId: string;
  navigationRef: RefObject<HTMLElement | null>;
  composerRef: RefObject<HTMLFormElement | null>;
  navigation: NativeNavigation;
  composer: NativeComposer;
  onDraftChange: (draft: string) => void;
  onBack: () => void;
  onDetails: () => void;
  onStop: () => void;
  onSurfaceChange?: (surface: 'chat' | 'computer') => void;
  onSettings?: () => void;
  onAttachment?: () => void;
}
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Presentation {
  version: 1;
  sessionId: string;
  scopeId: string;
  revision: number;
  draftSequence: number;
  visible: boolean;
  viewport: { width: number; height: number };
  navigation: NativeNavigation & { rect: Rect };
  composer: NativeComposer & { rect: Rect; visible: boolean };
}
type NativeAction = {
  sessionId: string;
  scopeId: string;
  sequence: number;
  type:
    | 'draft'
    | 'submit'
    | 'stop'
    | 'back'
    | 'details'
    | 'chat'
    | 'computer'
    | 'settings'
    | 'attachment';
  draft?: string;
};
interface NativeBridge {
  present(state: Presentation): Promise<{ active: boolean }>;
  hide(): Promise<void>;
  onAction(listener: (action: NativeAction) => void): Promise<() => void>;
}
interface CapacitorControls {
  present(state: Presentation): Promise<{ active: boolean }>;
  hide(): Promise<void>;
  addListener(
    name: 'action',
    callback: (action: NativeAction) => void,
  ): Promise<PluginListenerHandle>;
}
declare global {
  interface Window {
    hermesNativeControls?: NativeBridge;
  }
}
const plugin = registerPlugin<CapacitorControls>('HermesNativeControls');
function bridge(): NativeBridge | undefined {
  if (window.hermesNativeControls) return window.hermesNativeControls;
  if (Capacitor.getPlatform() !== 'ios' || !Capacitor.isPluginAvailable('HermesNativeControls'))
    return;
  return {
    present: (state) => plugin.present(state),
    hide: () => plugin.hide(),
    onAction: async (listener) => {
      const handle = await plugin.addListener('action', listener);
      return () => {
        void handle.remove();
      };
    },
  };
}
function rect(element: HTMLElement | null): Rect {
  const r = element?.getBoundingClientRect();
  return r
    ? { x: r.x, y: r.y, width: r.width, height: r.height }
    : { x: 0, y: 0, width: 0, height: 0 };
}

/** React owns state and submission. Native controls only edit and emit finite actions. */
export function useNativeControls(options: Options): boolean {
  const latest = useRef(options);
  latest.current = options;
  const schedule = useRef<() => void>(() => {});
  const [active, setActive] = useState(false);
  useEffect(() => {
    const host = bridge();
    if (!host) return;
    const sessionId = crypto.randomUUID();
    let disposed = false;
    let revision = 0;
    let sequence = 0;
    let scopeId = latest.current.scopeId;
    let frame = 0;
    let unsubscribe: (() => void) | undefined;
    let sending = false;
    let dirty = false;
    let marked: HTMLElement[] = [];
    const mark = (shown: boolean) => {
      marked.forEach((element) => element.removeAttribute('data-native-controls'));
      marked = shown
        ? [latest.current.navigationRef.current, latest.current.composerRef.current].filter(
            (v): v is HTMLElement => !!v,
          )
        : [];
      marked.forEach((element) => element.setAttribute('data-native-controls', 'active'));
      if (!disposed) setActive(shown);
    };
    const observer = new ResizeObserver(() => enqueue());
    const observed = new Set<HTMLElement>();
    async function publish() {
      if (disposed) return;
      if (sending) {
        dirty = true;
        return;
      }
      const current = latest.current;
      if (scopeId !== current.scopeId) {
        scopeId = current.scopeId;
        sequence = 0;
      }
      const navigationRect = rect(current.navigationRef.current);
      const composerRect = rect(current.composerRef.current);
      for (const element of [current.navigationRef.current, current.composerRef.current]) {
        if (element && !observed.has(element)) {
          observer.observe(element);
          observed.add(element);
        }
      }
      const visible = current.enabled && navigationRect.width > 0;
      const state: Presentation = {
        version: 1,
        sessionId,
        scopeId,
        revision: ++revision,
        draftSequence: sequence,
        visible,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        navigation: { ...current.navigation, rect: navigationRect },
        composer: {
          ...current.composer,
          rect: composerRect,
          visible: composerRect.width > 0 && composerRect.height >= 40,
        },
      };
      sending = true;
      try {
        const result = await host!.present(state);
        if (
          !disposed &&
          current.scopeId === latest.current.scopeId &&
          visible === latest.current.enabled
        )
          mark(result.active && visible);
      } catch {
        mark(false);
      } finally {
        sending = false;
        if (dirty && !disposed) {
          dirty = false;
          enqueue();
        }
      }
    }
    function enqueue() {
      if (!disposed && !frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          void publish();
        });
    }
    schedule.current = enqueue;
    void host
      .onAction((action) => {
        const current = latest.current;
        if (
          disposed ||
          !current.enabled ||
          action.sessionId !== sessionId ||
          action.scopeId !== current.scopeId
        )
          return;
        if (action.type === 'draft' || action.type === 'submit') {
          if (
            typeof action.draft !== 'string' ||
            !Number.isSafeInteger(action.sequence) ||
            action.sequence < sequence ||
            current.composer.disabled
          )
            return;
          sequence = action.sequence;
          flushSync(() => current.onDraftChange(action.draft!));
          if (action.type === 'submit' && !latest.current.composer.submitDisabled)
            latest.current.composerRef.current?.requestSubmit();
        } else if (action.type === 'back' && current.navigation.backVisible) current.onBack();
        else if (action.type === 'details' && current.navigation.detailsVisible)
          current.onDetails();
        else if (
          action.type === 'stop' &&
          current.composer.stopVisible &&
          !current.composer.stopDisabled
        )
          current.onStop();
        else if (action.type === 'settings' && current.navigation.settingsVisible)
          current.onSettings?.();
        else if (
          (action.type === 'chat' || action.type === 'computer') &&
          current.navigation.computerVisible
        )
          current.onSurfaceChange?.(action.type);
        else if (
          action.type === 'attachment' &&
          current.composer.attachmentVisible &&
          !current.composer.attachmentDisabled
        )
          current.onAttachment?.();
        enqueue();
      })
      .then((remove) => {
        if (disposed) remove();
        else {
          unsubscribe = remove;
          enqueue();
        }
      })
      .catch(() => mark(false));
    window.addEventListener('resize', enqueue);
    window.addEventListener('scroll', enqueue, true);
    window.visualViewport?.addEventListener('resize', enqueue);
    window.visualViewport?.addEventListener('scroll', enqueue);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      unsubscribe?.();
      observer.disconnect();
      window.removeEventListener('resize', enqueue);
      window.removeEventListener('scroll', enqueue, true);
      window.visualViewport?.removeEventListener('resize', enqueue);
      window.visualViewport?.removeEventListener('scroll', enqueue);
      schedule.current = () => {};
      mark(false);
      void host.hide().catch(() => {});
    };
  }, []);
  useEffect(() => schedule.current());
  return active;
}
