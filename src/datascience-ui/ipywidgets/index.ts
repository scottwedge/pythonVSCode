// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// import { Kernel, KernelMessage } from '@jupyterlab/services';
// import { EventEmitter } from 'events';
// import { Deferred } from '../../client/common/utils/async';
// import { IInteractiveWindowMapping } from '../../client/datascience/interactive-common/interactiveWindowTypes';
// import { PostOffice } from '../react-common/postOffice';
// import { IHtmlWidgetManager } from './types';

export { WidgetManager } from './manager';

// tslint:disable-next-line: no-any
// export const HtmlWidgetManager = (window as any).ipywidgets.main as IHtmlWidgetManager;
// console.log('ipywidgetsManager');
// console.log(HtmlWidgetManager);

// type CommTargetCallback = (comm: Kernel.IComm, msg: KernelMessage.ICommOpenMsg) => void | PromiseLike<void>;
// export interface IKernelEventEmitter {
//     on(event: 'commTargetRegistered', listener: (targetName: string, callback: CommTargetCallback) => void): this;
// }
// class ProxyKernel extends EventEmitter implements Partial<Kernel.IKernel>, IKernelEventEmitter {
//     constructor() {
//         super();
//     }
//     public registerCommTarget(targetName: string, callback: (comm: Kernel.IComm, msg: KernelMessage.ICommOpenMsg) => void | PromiseLike<void>): void {
//         this.emit('commTargetRegistered', targetName, callback);
//     }
// }

// export class IPyWidgetManager implements IIPyWidgetManager {
//     /**
//      * This ProxyKernel class doesn't implement all methods of the kernel interface.
//      * Only those that are required to get ipywidgets working.
//      * Hence the hacky cast.
//      *
//      * @type {Kernel.IKernel}
//      * @memberof Manager
//      */
//     public get kernel(): Kernel.IKernel {
//         // tslint:disable-next-line: no-any
//         return (this.proxyKernel as any) as Kernel.IKernel;
//     }
//     private readonly proxyKernel = new ProxyKernel();
//     // tslint:disable-next-line: no-any
//     private requestDeferredMap = new Map<string, { future: Kernel.IFuture; deferred: Deferred<any> }>();
//     private commTargetCallbacks = new Map<string, CommTargetCallback>();
//     private commIdOnMsg = new Map<string, Kernel.IComm>();
//     private postOffice!: PostOffice;
//     public registerPostOffice(postOffice: PostOffice) {
//         this.postOffice = postOffice;
//         postOffice.addHandler(this);
//     }
//     public dispose() {
//         this.proxyKernel.off('commTargetRegistered', this.onCommTargetRegistered);
//     }
//     // tslint:disable-next-line: no-any
//     public handleMessage(msg: string, payload?: any): boolean {
//         switch (msg) {
//             case 'shellSend_oniopub': {
//                 const requestId = payload.requestId;
//                 const reply = this.requestDeferredMap.get(requestId)!;
//                 reply.future.onIOPub(payload.msg);
//                 break;
//             }
//             case 'shellSend_reply': {
//                 const requestId = payload.requestId;
//                 const reply = this.requestDeferredMap.get(requestId)!;
//                 reply.future.onReply(payload.msg);
//                 reply.deferred.resolve(payload.msg);
//                 break;
//             }
//             case 'comm_msg': {
//                 const comm = this.commIdOnMsg.get(payload.commId)!;
//                 if (comm) {
//                     comm.onMsg(payload.msg);
//                 }
//                 break;
//             }
//             case 'oniopub':
//                 try {
//                     try {
//                         if (payload.content && payload.content.comm_id && payload.content.target_name === 'jupyter.widget' && payload.msg_type === 'comm_open') {
//                             if (!payload.content.commId) {
//                                 payload.content.commId = payload.content.comm_id;
//                             }
//                             debugger;
//                             const comm: Kernel.IComm = payload.content;
//                             comm.onMsg = noop;
//                             this.commIdOnMsg.set(payload.content.comm_id, comm);
//                             (comm as any).send = (data: JSONValue, metadata?: JSONObject, _buffers?: (ArrayBuffer | ArrayBufferView)[], _disposeOnDone?: boolean) => {
//                                 debugger;
//                                 console.log('Sending');
//                                 const requestId = uuid();
//                                 const deferred = createDeferred<any>();
//                                 const reply: Kernel.IFuture = {
//                                     onIOPub: noop,
//                                     onReply: noop,
//                                     onStdin: noop,
//                                     done: deferred.promise,
//                                     msg: {
//                                         header: {
//                                             msg_id: requestId
//                                         }
//                                     }
//                                 } as any;
//                                 this.requestDeferredMap.set(requestId, { future: reply, deferred });

//                                 this.sendMessage('shellSend', { data, metadata, commId: payload.content.commId, requestId });
//                                 return reply;
//                             };
//                             // commTargetCallback(comm, payload);
//                             const callback = this.commTargetCallbacks.get(payload.content.target_name);
//                             if (callback) {
//                                 callback(comm, payload);
//                             } else {
//                                 console.error(`Comm Target callback not registered for ${payload.content.target_name}`);
//                             }
//                         } else {
//                             debugger;
//                         }
//                     } catch (ex) {
//                         console.error('Failed to exec commTargetCallback', ex);
//                     }
//                     (document as any).onIOPub(payload);
//                 } catch (ex) {
//                     console.error('Failed to exec onIOPub', ex);
//                 }
//                 break;
//             default:
//                 break;
//         }
//         return true;
//     }

//     protected onCommTargetRegistered(targetName: string, callback: CommTargetCallback) {
//         this.commTargetCallbacks.set(targetName, callback);
//     }
//     private sendMessage<M extends IInteractiveWindowMapping, T extends keyof M>(type: T, payload?: M[T]) {
//         this.postOffice.sendMessage(type, payload);
//     }
// }
