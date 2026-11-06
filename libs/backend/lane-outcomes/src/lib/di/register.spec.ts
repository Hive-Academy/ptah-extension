import { container as rootContainer } from 'tsyringe';
import {
  FileType,
  PLATFORM_TOKENS,
  type IFileSystemProvider,
} from '@ptah-extension/platform-core';
import type { SdkAdapterSubagentEndedEvent } from '@ptah-extension/agent-sdk';
import { LaneOutcomeRecorder } from '../lane-outcome-recorder.service';
import { MemoryState, testLogger } from '../write/pipeline.test-support';
import { OutcomeWritePipeline } from '../write/outcome-write-pipeline';
import { LANE_OUTCOME_PIPELINE, registerLaneOutcomeServices } from './register';
import { LANE_OUTCOME_TOKENS } from './tokens';

type DeliverableFs = Pick<IFileSystemProvider, 'stat' | 'realpath'>;

function containerWith(fileSystem?: DeliverableFs) {
  const container = rootContainer.createChildContainer();
  container.registerInstance(PLATFORM_TOKENS.STATE_STORAGE, new MemoryState());
  if (fileSystem)
    container.registerInstance(
      PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER,
      fileSystem,
    );
  registerLaneOutcomeServices(container, testLogger());
  return container;
}

function ended(): SdkAdapterSubagentEndedEvent {
  return {
    agentId: 'register-agent',
    agentType: 'backend-developer',
    sessionId: 'parent',
    cwd: '/workspace',
    lastAssistantMessage: 'WROTE: out.md',
    backgroundTasks: [],
    timestamp: Date.now(),
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1)
    await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('registerLaneOutcomeServices filesystem resolution', () => {
  it.each([
    ['with', true],
    ['without', false],
  ])('resolves the recorder %s a filesystem port', async (_label, bound) => {
    const realpath = jest.fn(async (target: string) => target);
    const stat = jest.fn(async () => ({
      type: FileType.File,
      ctime: 0,
      mtime: 0,
      size: 1,
    }));
    const container = containerWith(bound ? { realpath, stat } : undefined);
    const pipeline = container.resolve<OutcomeWritePipeline>(
      LANE_OUTCOME_PIPELINE,
    );
    try {
      const recorder = container.resolve<LaneOutcomeRecorder>(
        LANE_OUTCOME_TOKENS.RECORDER,
      );
      expect(recorder).toBeInstanceOf(LaneOutcomeRecorder);
      recorder.recordSubagentEnded(ended());
      await settle();
      await pipeline.flush();
      if (bound) {
        expect(realpath).toHaveBeenCalledWith('/workspace');
        expect(stat).toHaveBeenCalledWith('/workspace/out.md');
      } else {
        expect(realpath).not.toHaveBeenCalled();
        expect(stat).not.toHaveBeenCalled();
      }
    } finally {
      await pipeline.dispose();
    }
  });
});
