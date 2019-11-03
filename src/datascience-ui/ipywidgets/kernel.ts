// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { Kernel, KernelMessage } from '@jupyterlab/services';
import * as uuid from 'uuid/v4';
import { createDeferred, Deferred } from '../../client/common/utils/async';
import { noop } from '../../client/common/utils/misc';
import { IInteractiveWindowMapping, InteractiveWindowMessages } from '../../client/datascience/interactive-common/interactiveWindowTypes';
import { CommTargetCallback } from './types';

type CommTargetRegisteredHandler = (targetName: string, callback: CommTargetCallback) => void;
function serializeDataViews(buffers: undefined | (ArrayBuffer | ArrayBufferView)[]) {
    if (!buffers || !Array.isArray(buffers) || buffers.length === 0) {
        return;
    }
    // tslint:disable-next-line: no-any
    const newBufferView: any[] = [];
    // tslint:disable-next-line: prefer-for-of
    for (let i = 0; i < buffers.length; i += 1) {
        const item = buffers[i];
        if ('buffer' in item && 'byteOffset' in item) {
            // It is an ArrayBufferView
            // tslint:disable-next-line: no-any
            const buffer = Array.apply(null, new Uint8Array(item.buffer as any) as any);
            newBufferView.push({
                ...item,
                byteLength: item.byteLength,
                byteOffset: item.byteOffset,
                buffer
                // tslint:disable-next-line: no-any
            } as any);
        } else {
            // tslint:disable-next-line: no-any
            newBufferView.push(Array.apply(null, new Uint8Array(item as any) as any) as any);
        }
    }

    // tslint:disable-next-line: no-any
    // msg.buffers = JSON.stringify(newBufferView) as any;
    return newBufferView;
}

export interface IMessageSender {
    sendMessage<M extends IInteractiveWindowMapping, T extends keyof M>(type: T, payload?: M[T]): void;
}

export class ClassicCommShellCallbackManager {
    private requestFutureMap = new Map<string, { future: Kernel.IShellFuture; deferred: Deferred<KernelMessage.IShellMessage | undefined> }>();
    public registerFuture(requestId: string, future: Kernel.IShellFuture, deferred: Deferred<KernelMessage.IShellMessage | undefined>) {
        this.requestFutureMap.set(requestId, { future, deferred });
    }
    public unregisterFuture(requestId: string) {
        this.requestFutureMap.delete(requestId);
    }
    // tslint:disable-next-line: no-any
    public async handleShellCallbacks(msg: string, payload?: any): Promise<void> {
        switch (msg) {
            case InteractiveWindowMessages.IPyWidgets_ShellSend_onIOPub: {
                // We got an `iopub` message on the comm for the `shell_` message that was sent by ipywidgets.
                // The `shell` message was sent using our custom `IComm` component provided to ipywidgets.
                // ipywidgets uses the `IComm.send` method.
                const requestId = payload.requestId;
                const reply = this.requestFutureMap.get(requestId)!;
                reply.future.onIOPub(payload.msg);
                break;
            }
            case InteractiveWindowMessages.IPyWidgets_ShellSend_reply: {
                // We got a `reply` message on the comm for the `shell_` message that was sent by ipywidgets.
                // The `shell` message was sent using our custom `IComm` component provided to ipywidgets.
                // ipywidgets uses the `IComm.send` method.
                const requestId = payload.requestId;
                const reply = this.requestFutureMap.get(requestId)!;
                reply.future.onReply(payload.msg);
                break;
            }
            case InteractiveWindowMessages.IPyWidgets_ShellSend_resolve: {
                // We got a `reply` message on the comm for the `shell_` message that was sent by ipywidgets.
                // The `shell` message was sent using our custom `IComm` component provided to ipywidgets.
                // ipywidgets uses the `IComm.send` method.
                const requestId = payload.requestId;
                const reply = this.requestFutureMap.get(requestId)!;
                this.unregisterFuture(requestId);
                reply.deferred.resolve(payload.msg);
                break;
            }
            case InteractiveWindowMessages.IPyWidgets_ShellSend_reject: {
                // We got a `reply` message on the comm for the `shell_` message that was sent by ipywidgets.
                // The `shell` message was sent using our custom `IComm` component provided to ipywidgets.
                // ipywidgets uses the `IComm.send` method.
                const requestId = payload.requestId;
                const reply = this.requestFutureMap.get(requestId)!;
                this.unregisterFuture(requestId);
                reply.deferred.reject(payload.msg);
                break;
            }
            default:
                break;
        }
    }
}
export class ClassicComm implements Kernel.IComm {
    public isDisposed: boolean = false;
    public onClose: (msg: KernelMessage.ICommCloseMsg) => void | PromiseLike<void> = noop;
    public onMsg: (msg: KernelMessage.ICommMsgMsg) => void | PromiseLike<void> = noop;
    private readonly registeredFutures: string[] = [];
    constructor(
        public readonly commId: string,
        public readonly targetName: string,
        private readonly messageSender: IMessageSender,
        private readonly callbackManager: ClassicCommShellCallbackManager
    ) {}
    // tslint:disable-next-line: no-any
    public open(data?: any, metadata?: any, buffers?: (ArrayBuffer | ArrayBufferView)[] | undefined): Kernel.IShellFuture {
        // tslint:disable-next-line: no-console
        const requestId = uuid();
        const commId: string = this.commId;
        const deferred = createDeferred<KernelMessage.IShellMessage | undefined>();
        // Create a dummy response (IFuture) that we'll send to ipywidgets controls.
        // Dummy because the actual IFuture object will be on the extension side.
        // tslint:disable-next-line: no-any
        const shellMessage = ({ header: { msg_id: requestId } } as any) as KernelMessage.IShellMessage;
        const reply: Partial<Kernel.IShellFuture> = {
            onIOPub: noop,
            onReply: noop,
            onStdin: noop,
            done: deferred.promise,
            msg: shellMessage
        };
        // tslint:disable-next-line: no-any
        const future = (reply as any) as Kernel.IShellFuture;
        // Keep track of the future.
        // When messages arrive from extension we can resolve this future.
        this.registeredFutures.push(requestId);
        this.callbackManager.registerFuture(requestId, future, deferred);
        const targetName = this.targetName;
        const msgType = 'comm_open';
        // Send this payload to the extension where we'll use the real comms to send to the kernel.
        // The response will be handled and sent back as messages to the UI as messages `shellSend_*`
        this.messageSender.sendMessage(InteractiveWindowMessages.IPyWidgets_ShellSend, {
            data,
            metadata,
            commId,
            requestId,
            buffers: serializeDataViews(buffers),
            targetName,
            msgType
        });

        // ipywidgets will use this as a promise (ifuture).
        return future;
    }
    // tslint:disable-next-line: no-any
    public close(_data?: any, _metadata?: any, _buffers?: (ArrayBuffer | ArrayBufferView)[] | undefined): Kernel.IShellFuture {
        this.registeredFutures.forEach(item => this.callbackManager.unregisterFuture(item));
        throw new Error('VSCPython.IClassicComm.Close method not implemented!');
    }
    public dispose(): void {
        this.registeredFutures.forEach(item => this.callbackManager.unregisterFuture(item));
    }
    // tslint:disable-next-line: no-any
    public send(data: any, metadata?: any, buffers?: (ArrayBuffer | ArrayBufferView)[] | undefined, disposeOnDone?: boolean | undefined): Kernel.IShellFuture {
        // tslint:disable-next-line: no-console
        const requestId = uuid();
        const commId: string = this.commId;
        const deferred = createDeferred<KernelMessage.IShellMessage | undefined>();
        // Create a dummy response (IFuture) that we'll send to ipywidgets controls.
        // Dummy because the actual IFuture object will be on the extension side.
        // tslint:disable-next-line: no-any
        const shellMessage = ({ header: { msg_id: requestId } } as any) as KernelMessage.IShellMessage;
        const reply: Partial<Kernel.IShellFuture> = {
            onIOPub: noop,
            onReply: noop,
            onStdin: noop,
            done: deferred.promise,
            msg: shellMessage
        };
        // tslint:disable-next-line: no-any
        const future = (reply as any) as Kernel.IShellFuture;
        // Keep track of the future.
        // When messages arrive from extension we can resolve this future.
        this.registeredFutures.push(requestId);
        this.callbackManager.registerFuture(requestId, future, deferred);
        // const targetName = this.targetName;
        const targetName = undefined;
        const msgType = 'comm_msg';
        // Send this payload to the extension where we'll use the real comms to send to the kernel.
        // The response will be handled and sent back as messages to the UI as messages `shellSend_*`
        this.messageSender.sendMessage(InteractiveWindowMessages.IPyWidgets_ShellSend, {
            data,
            metadata,
            commId,
            requestId,
            disposeOnDone,
            buffers: serializeDataViews(buffers),
            targetName,
            msgType
        });

        // ipywidgets will use this as a promise (ifuture).
        return future;
    }
}

/**
 * This is a proxy Kernel that ipython will use to communicate with jupyter.
 * It only requires the `registerCommTarget` method to list to comm messages.
 * That's why we only implement that method.
 *
 * @export
 * @class ProxyKernel
 * @implements {Partial<Kernel.IKernel>}
 */
export class ProxyKernel implements Partial<Kernel.IKernel> {
    private commRegistrationMessagesToSend: string[] = [];
    private readonly handlers: CommTargetRegisteredHandler[] = [];
    private commTargetCallbacks = new Map<string, CommTargetCallback>();
    private commsById = new Map<string, Kernel.IComm>();
    private readonly shellCallbackManager = new ClassicCommShellCallbackManager();
    constructor(private readonly messageSender: IMessageSender) {}
    /**
     * This method is used by ipywidgets manager.
     *
     * @param {string} targetName
     * @param {CommTargetCallback} callback
     * @memberof ProxyKernel
     */
    public registerCommTarget(targetName: string, callback: CommTargetCallback): void {
        this.commRegistrationMessagesToSend.push(targetName);
        this.handlers.forEach(handler => handler(targetName, callback));
        this.commTargetCallbacks.set(targetName, callback);
    }
    public connectToComm(targetName: string, commId: string = uuid()): Kernel.IComm {
        return this.commsById.get(commId) || this.createComm(targetName, commId);
    }
    public dispose() {
        while (this.handlers.shift()) {
            noop();
        }
    }
    public initialize(): void {
        this.commRegistrationMessagesToSend.forEach(targetName => this.messageSender.sendMessage(InteractiveWindowMessages.IPyWidgets_registerCommTarget, targetName));
        this.commRegistrationMessagesToSend = [];
    }
    // tslint:disable-next-line: no-any
    public async handleMessageAsync(msg: string, payload?: any): Promise<void> {
        switch (msg) {
            case InteractiveWindowMessages.IPyWidgets_comm_msg: {
                // We got a `comm_msg` on the comm channel from kernel.
                // These messages must be given to all widgets, to update their states.
                // The `shell` message was sent using our custom `IComm` component provided to ipywidgets.
                // ipywidgets uses the `IComm.send` method.

                // These messages need to be propagated back on the `onMsg` callback.
                const commMsg = payload as KernelMessage.ICommMsgMsg;
                if (commMsg.content && commMsg.content.comm_id) {
                    const comm = this.commsById.get(commMsg.content.comm_id);
                    if (comm) {
                        const promise = comm.onMsg(commMsg);
                        if (promise) {
                            await promise;
                        }
                    }
                }
                break;
            }
            case InteractiveWindowMessages.IPyWidgets_comm_open:
                await this.handleCommOpen(msg, payload);
                break;
            default:
                await this.shellCallbackManager.handleShellCallbacks(msg, payload);
                break;
        }
    }
    protected async onCommOpen(msg: KernelMessage.ICommOpenMsg) {
        if (!msg.content || !msg.content.comm_id || msg.content.target_name !== 'jupyter.widget') {
            throw new Error('Unknown comm open message');
        }
        const commTargetCallback = this.commTargetCallbacks.get(msg.content.target_name);
        if (!commTargetCallback) {
            throw new Error(`Comm Target callback not registered for ${msg.content.target_name}`);
        }

        const comm = this.createComm(msg.content.target_name, msg.content.comm_id);

        // Invoke the CommOpen callbacks with the comm and the corresponding message.
        // This is the handshake with the ipywidgets.
        // At this point ipywidgets manager has the comm object it needs to communicate with the kernel.
        const promise = commTargetCallback(comm, msg);
        // tslint:disable-next-line: no-any
        if (promise && (promise as any).then) {
            await promise;
        }
    }
    private createComm(targetName: string, commId: string): Kernel.IComm {
        // Create the IComm object that ipywidgets will use to communicate directly with the kernel.
        const comm = new ClassicComm(commId, targetName, this.messageSender, this.shellCallbackManager);
        // const comm = this.createKernelCommForCommOpenCallback(msg);

        // When messages arrive on `onMsg` in the comm component, we need to send these back.
        // Remember, `comm` here is a bogus IComm object.
        // The actual object is at the extension end. Back there we listen to messages arriving
        // in the callback of `IComm.onMsg`, those will come into this class and we need to send
        // them through the `comm` object. To propogate those messages we need to tie the delegate to the comm id.
        this.commsById.set(commId, comm);
        return comm;
    }
    // tslint:disable-next-line: no-any
    private async handleCommOpen(msg: string, payload?: any): Promise<void> {
        if (msg !== InteractiveWindowMessages.IPyWidgets_comm_open) {
            return;
        }
        // Happens when a comm is opened (generatelly part of a cell execution).
        // We're only interested in `comm_open` messages.
        if (payload && payload.msg_type === 'comm_open') {
            const commOpenMessage = payload as KernelMessage.ICommOpenMsg;
            try {
                await this.onCommOpen(commOpenMessage);
            } catch (ex) {
                console.error('Failed to exec commTargetCallback', ex);
            }
        }
    }
}
