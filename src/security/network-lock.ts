let activation: Promise<NetworkLockSession> | undefined
let networkLockActive = false
let lockRequestSequence = 0

const activationTimeoutMilliseconds = 10_000

type UpdateListener = () => void

export type NetworkLockSession = Readonly<{
  version: string
  readonly updateAvailable: boolean
  subscribeToUpdate: (listener: UpdateListener) => () => void
  activateUpdate: () => Promise<void>
}>

/**
 * Activates the one-way session Network Lock only after the service worker has
 * atomically precached required application assets and controls this page.
 */
export function activateNetworkLock(): Promise<NetworkLockSession> {
  activation ??= prepareNetworkLock()
  return activation
}

async function prepareNetworkLock(): Promise<NetworkLockSession> {
  if (
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator) ||
    typeof globalThis.fetch !== 'function' ||
    typeof location === 'undefined'
  ) {
    throw new Error('Network Lock is unavailable in this browser.')
  }

  const registration = await navigator.serviceWorker.register('/sw.js', {
    scope: '/',
    updateViaCache: 'none',
  })
  const updateSubscription = trackUpdates(registration)
  await navigator.serviceWorker.ready
  const controller = await waitForController()
  const version = await requestServiceWorkerLock(controller)
  if (version !== 'development') {
    installFetchGuard()
    installWebSocketGuard()
    reloadWhenControllerChanges(controller)
    networkLockActive = true
  }

  return Object.freeze({
    version,
    get updateAvailable() {
      return updateSubscription.available
    },
    subscribeToUpdate(listener: UpdateListener) {
      return updateSubscription.subscribe(listener)
    },
    async activateUpdate() {
      const waiting = registration.waiting
      if (waiting === null) {
        throw new Error('No Network Lock update is available.')
      }
      await requestUpdateActivation(waiting)
    },
  })
}

function trackUpdates(registration: ServiceWorkerRegistration): Readonly<{
  readonly available: boolean
  subscribe: (listener: UpdateListener) => () => void
}> {
  const listeners = new Set<UpdateListener>()

  const notifyIfWaiting = (): void => {
    if (registration.active === null || registration.waiting === null) return
    for (const listener of listeners) listener()
  }
  const watchInstallingWorker = (): void => {
    const installing = registration.installing
    if (installing === null) return
    installing.addEventListener('statechange', notifyIfWaiting)
  }

  registration.addEventListener('updatefound', watchInstallingWorker)
  watchInstallingWorker()

  return {
    get available() {
      return registration.active !== null && registration.waiting !== null
    },
    subscribe(listener: UpdateListener) {
      listeners.add(listener)
      notifyIfWaiting()
      return () => listeners.delete(listener)
    },
  }
}

async function waitForController(): Promise<ServiceWorker> {
  if (navigator.serviceWorker.controller !== null) {
    return navigator.serviceWorker.controller
  }
  return await new Promise<ServiceWorker>((resolve, reject) => {
    const timeout = setTimeout(() => {
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        handleControllerChange,
      )
      reject(new Error('Network Lock controller activation timed out.'))
    }, activationTimeoutMilliseconds)
    const handleControllerChange = (): void => {
      const controller = navigator.serviceWorker.controller
      if (controller === null) return
      clearTimeout(timeout)
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        handleControllerChange,
      )
      resolve(controller)
    }
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      handleControllerChange,
    )
  })
}

async function requestServiceWorkerLock(
  controller: ServiceWorker,
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const channel = new MessageChannel()
    const requestId = `network-lock-${Date.now().toString(36)}-${++lockRequestSequence}`
    const message = {
      type: 'activate-network-lock',
      requestId,
    }
    const handleAcknowledgement = (event: MessageEvent<unknown>): void => {
      if (
        typeof event.data !== 'object' ||
        event.data === null ||
        !('type' in event.data) ||
        event.data.type !== 'network-lock-active' ||
        !('requestId' in event.data) ||
        event.data.requestId !== requestId ||
        !('version' in event.data) ||
        typeof event.data.version !== 'string' ||
        !/^(?:[a-f0-9]{16}|development)$/.test(event.data.version)
      ) {
        return
      }
      clearTimeout(timeout)
      navigator.serviceWorker.removeEventListener(
        'message',
        handleAcknowledgement,
      )
      channel.port1.close()
      resolve(event.data.version)
    }
    const timeout = setTimeout(() => {
      navigator.serviceWorker.removeEventListener(
        'message',
        handleAcknowledgement,
      )
      channel.port1.close()
      reject(new Error('Network Lock acknowledgement timed out.'))
    }, activationTimeoutMilliseconds)
    navigator.serviceWorker.addEventListener('message', handleAcknowledgement)
    channel.port1.addEventListener('message', handleAcknowledgement)
    navigator.serviceWorker.startMessages?.()
    channel.port1.start()
    try {
      controller.postMessage(message, [channel.port2])
    } catch {
      try {
        controller.postMessage(message)
      } catch (error) {
        clearTimeout(timeout)
        navigator.serviceWorker.removeEventListener(
          'message',
          handleAcknowledgement,
        )
        channel.port1.close()
        reject(error)
      }
    }
  })
}

function reloadWhenControllerChanges(controller: ServiceWorker): void {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const replacement = navigator.serviceWorker.controller
    if (replacement === null || replacement === controller) return
    setTimeout(() => location.reload(), 0)
  })
}

async function requestUpdateActivation(waiting: ServiceWorker): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        handleControllerChange,
      )
      reject(new Error('Network Lock update activation timed out.'))
    }, activationTimeoutMilliseconds)
    const handleControllerChange = (): void => {
      clearTimeout(timeout)
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        handleControllerChange,
      )
      resolve()
    }
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      handleControllerChange,
    )
    waiting.postMessage({ type: 'activate-network-lock-update' })
  })
}

function installFetchGuard(): void {
  if (networkLockActive) return
  const unlockedFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const target =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : input
    const url = new URL(target, location.href)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return Promise.reject(
        new TypeError('Network Lock rejected a runtime network request.'),
      )
    }
    return unlockedFetch(input, init)
  }) as typeof globalThis.fetch
}

function installWebSocketGuard(): void {
  if (networkLockActive || typeof globalThis.WebSocket !== 'function') return
  globalThis.WebSocket = new Proxy(globalThis.WebSocket, {
    apply(): never {
      throw new TypeError('Network Lock rejected a WebSocket connection.')
    },
    construct(): never {
      throw new TypeError('Network Lock rejected a WebSocket connection.')
    },
  })
}
