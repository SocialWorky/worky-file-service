declare module '@bull-board/api' {
  import { ExpressAdapter } from '@bull-board/express';
  import { Router } from 'express';
  import { BullMQAdapter } from '@bull-board/bullmq-adapter';

  function createBullBoard(args: { queues: BullMQAdapter[] }): {
    router: Router;
  };
  export { createBullBoard, ExpressAdapter, BullMQAdapter };
}
