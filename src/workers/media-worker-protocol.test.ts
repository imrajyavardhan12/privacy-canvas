import { describe, expect, it } from 'vitest'
import {
  MEDIA_WORKER_PROTOCOL_VERSION,
  readMediaWorkerRequest,
  readMediaWorkerResponse,
} from './media-worker-protocol'

describe('media worker protocol', () => {
  it('rejects malformed messages at both sides of the worker boundary', () => {
    expect(
      readMediaWorkerRequest({
        protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
        requestId: 1,
        type: 'open-source',
        sourceBytes: 'not transferable bytes',
      }),
    ).toBeUndefined()

    expect(
      readMediaWorkerResponse({
        protocolVersion: MEDIA_WORKER_PROTOCOL_VERSION,
        requestId: 1,
        type: 'source-ready',
        inspection: {},
      }),
    ).toBeUndefined()
  })
})
