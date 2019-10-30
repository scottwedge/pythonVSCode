// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { Kernel, KernelMessage } from '@jupyterlab/services';
import { nbformat } from '@jupyterlab/services/node_modules/@jupyterlab/coreutils';
import * as uuid from 'uuid/v4';
import { createDeferred, Deferred } from '../../client/common/utils/async';
import { noop } from '../../client/common/utils/misc';
import { IInteractiveWindowMapping, InteractiveWindowMessages } from '../../client/datascience/interactive-common/interactiveWindowTypes';
import { PostOffice } from '../react-common/postOffice';
import { ProxyKernel } from './kernel';
import { CommTargetCallback, IHtmlWidgetManager, IHtmlWidgetManagerCtor, IIPyWidgetManager } from './types';

// The HTMLWidgetManager will be exposed in the global variable `window.ipywidgets.main` (check webpack config).
// tslint:disable-next-line: no-any
const HtmlWidgetManager = (window as any).vscIPyWidgets.WidgetManager as IHtmlWidgetManagerCtor;
if (!HtmlWidgetManager) {
    throw new Error('HtmlWidgetManager not defined. Please include/check ipywidgets.js file');
}
export class WidgetManager implements IIPyWidgetManager {
    public static instance: WidgetManager;
    public manager!: IHtmlWidgetManager;
    public commOpenHandled: string[] = [];
    // tslint:disable-next-line: no-any
    private commTargetCallbacks = new Map<string, CommTargetCallback>();
    private requestFutureMap = new Map<string, { future: Kernel.IFuture; deferred: Deferred<KernelMessage.IShellMessage | undefined> }>();
    private commIdOnMsg = new Map<string, Kernel.IComm>();
    private readonly proxyKernel = new ProxyKernel();
    private postOffice!: PostOffice;
    private messagesToSend: string[] = [];
    /**
     * Contains promises related to model_ids that need to be displayed.
     * When we receive a message from the kernel of type = `display_data` for a widget (`application/vnd.jupyter.widget-view+json`),
     * then its time to display this.
     * We need to keep track of this. A boolean is sufficient, but we're using a promise so we can be notified when it is ready.
     *
     * @private
     * @memberof WidgetManager
     */
    private modelIdsToBeDisplayed = new Map<string, Deferred<void>>();
    constructor(widgetContainer: HTMLElement) {
            debugger;
            this.proxyKernel.on('commTargetRegistered', this.onCommTargetRegistered.bind(this));
            // tslint:disable-next-line: no-any
            const kernel = (this.proxyKernel as any) as Kernel.IKernel;
            this.manager = new HtmlWidgetManager(kernel, widgetContainer);
            WidgetManager.instance = this;
    }
    public dispose(): void {
        this.proxyKernel.dispose();
        try {
            this.postOffice.removeHandler(this);
        } catch {
            noop();
        }
    }
    public registerPostOffice(postOffice: PostOffice): void {
        this.postOffice = postOffice;
        postOffice.addHandler(this);

        this.messagesToSend.forEach(targetName => this.sendMessage(InteractiveWindowMessages.IPyWidgets_registerCommTarget, targetName));
        this.messagesToSend = [];
    }
    public async clear(): Promise<void> {
        await this.manager.clear_state();
    }
    // tslint:disable-next-line: member-ordering no-any
    private pendingMessages: {msg: string, payload?: any}[] = [];
    // tslint:disable: member-ordering
    private busyProcessingMessages: boolean = false;
    // tslint:disable-next-line: no-any
    public handleMessage(msg: string, payload?: any): boolean {
        this.pendingMessages.push({msg, payload});
        setTimeout(() => this.handleMessagesAsync().ignoreErrors(), 1);
        return true;
    }
    private async handleMessagesAsync(){
        if (this.busyProcessingMessages){
            return;
        }
        this.busyProcessingMessages = true;
        while (this.pendingMessages.length > 0) {
            const data = this.pendingMessages.shift()!;
            try {
                await this.handleMessageAsync(data.msg, data.payload);
            } catch (ex){
                // tslint:disable-next-line: no-console
                console.error('Failed to process a message', ex);
            }
        }
        this.busyProcessingMessages = false;
        if (this.pendingMessages.length > 0){
            setTimeout(() => this.handleMessagesAsync().ignoreErrors(), 1);
        }
    }
    // tslint:disable-next-line: max-func-body-length no-any member-ordering no-any
    public async handleMessageAsync(msg: string, payload?: any): Promise<void> {
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
                reply.deferred.resolve(payload.msg);
                break;
            }
            case InteractiveWindowMessages.IPyWidgets_ShellSend_reject: {
                // We got a `reply` message on the comm for the `shell_` message that was sent by ipywidgets.
                // The `shell` message was sent using our custom `IComm` component provided to ipywidgets.
                // ipywidgets uses the `IComm.send` method.
                const requestId = payload.requestId;
                const reply = this.requestFutureMap.get(requestId)!;
                reply.deferred.reject(payload.msg);
                break;
            }
            case InteractiveWindowMessages.IPyWidgets_comm_msg: {
                // We got a `comm_msg` on the comm channel from kernel.
                // These messages must be given to all widgets, to update their states.
                // The `shell` message was sent using our custom `IComm` component provided to ipywidgets.
                // ipywidgets uses the `IComm.send` method.

                // These messages need to be propagated back on the `onMsg` callback.
                const commMsg = payload as KernelMessage.ICommMsgMsg;
                if (commMsg.content && commMsg.content.comm_id){
                    const comm = this.commIdOnMsg.get(commMsg.content.comm_id);
                    if (comm) {
                        comm.onMsg(commMsg);
                    }
                }
                break;
            }
            case InteractiveWindowMessages.IPyWidgets_display_data_msg: {
                // General IOPub message
                const displayMsg = payload as KernelMessage.IDisplayDataMsg;

                if (displayMsg.content &&
                    displayMsg.content.data &&
                    displayMsg.content.data['application/vnd.jupyter.widget-view+json']) {
                    // tslint:disable-next-line: no-any
                    const data = displayMsg.content.data['application/vnd.jupyter.widget-view+json'] as any;
                    const modelId = data.model_id;

                    if (!this.modelIdsToBeDisplayed.has(modelId)){
                        this.modelIdsToBeDisplayed.set(modelId, createDeferred());
                    }
                    // Mark it as completed (i.e. ready to display).
                    this.modelIdsToBeDisplayed.get(modelId)!.resolve();
                    // await this.renderWidget(data, this.widgetContainer);
                }
                break;
            }
            case InteractiveWindowMessages.IPyWidgets_comm_open:
                // Happens when a comm is opened (generatelly part of a cell execution).
                // We're only interested in `comm_open` messages.
                if (payload && payload.msg_type === 'comm_open') {
                    const commOpenMessage = payload as KernelMessage.ICommOpenMsg;
                    try {
                        await this.onCommOpen(commOpenMessage);
                    } catch (ex) {
                        console.error('Failed to exec commTargetCallback', ex);
                        // try {
                        //     await this.onCommOpen(commOpenMessage);
                        //     this.commOpenHandled.push(commOpenMessage.content.comm_id);
                        // } catch (ex) {
                        //     console.error('Failed to exec commTargetCallback', ex);
                        // }
                    }
                }
                break;
            default:
                break;
        }
    }
    public async renderWidget(data: nbformat.IMimeBundle & {model_id: string; version_major: number}, ele: HTMLElement): Promise<{ dispose: Function }> {
        if (!data) {
            throw new Error('application/vnd.jupyter.widget-view+json not in msg.content.data, as msg.content.data is \'undefined\'.');
        }

        if (!data || data.version_major !== 2) {
            console.warn('Widget data not avaialble to render an ipywidget');
            return { dispose: noop };
        }

        const modelId = data.model_id as string;
        // Check if we have processed the data for this model.
        // If not wait.
        if (!this.modelIdsToBeDisplayed.has(modelId)){
            this.modelIdsToBeDisplayed.set(modelId, createDeferred());
        }
        // Wait until it is flagged as ready to be processed.
        // This widget manager must have recieved this message and performed all operations before this.
        // Once all messages prior to this have been processed in sequence and this message is receievd,
        // then, and only then are we ready to render the widget.
        // I.e. this is a way of synchronzing the render with the processing of the messages.
        await this.modelIdsToBeDisplayed.get(modelId)!.promise;

        const modelPromise = this.manager.get_model(data.model_id);
        if (!modelPromise) {
            console.warn('Widget model not avaialble to render an ipywidget');
            return { dispose: noop };
        }

        // ipywdigets may not have completed creating the model.
        // ipywidgets have a promise, as the model may get created by a 3rd party library.
        // That 3rd party library may not be available and may have to be downloaded.
        // Hence the promise to wait until it has been created.
        const model = await modelPromise;
        // tslint:disable-next-line: no-floating-promises no-any
        ((this.manager as any).get_state() as Promise<any>).then(s => {
            console.error('state');
            console.error(s);
            console.error(JSON.stringify(s));
        }).catch(ex => console.error('failed to get state', ex));
        const view = await this.manager.create_view(model, { el: ele });
        // tslint:disable-next-line: no-any
        return this.manager.display_view(view, { el: ele }).then(vw => ({ dispose: vw.remove.bind(vw) }));
    }
    /**
     * Handle `comm_open` messages.
     *
     * @protected
     * @param {KernelMessage.ICommOpenMsg} msg
     * @memberof WidgetManager
     */
    protected async onCommOpen(msg: KernelMessage.ICommOpenMsg) {
        if (!msg.content || !msg.content.comm_id || msg.content.target_name !== 'jupyter.widget') {
            throw new Error('Unknown comm open message');
        }
        const commTargetCallback = this.commTargetCallbacks.get(msg.content.target_name);
        if (!commTargetCallback) {
            throw new Error(`Comm Target callback not registered for ${msg.content.target_name}`);
        }

        // Create the IComm object that ipywidgets will use to communicate directly with the kernel.
        const comm = this.createKernelCommForCommOpenCallback(msg);

        // When messages arrive on `onMsg` in the comm component, we need to send these back.
        // Remember, `comm` here is a bogus IComm object.
        // The actual object is at the extension end. Back there we listen to messages arriving
        // in the callback of `IComm.onMsg`, those will come into this class and we need to send
        // them through the `comm` object. To propogate those messages we need to tie the delegate to the comm id.
        this.commIdOnMsg.set(msg.content.comm_id, comm);

        // Invoke the CommOpen callbacks with the comm and the corresponding message.
        // This is the handshake with the ipywidgets.
        // At this point ipywidgets manager has the comm object it needs to communicate with the kernel.
        const promise = commTargetCallback(comm, msg);
        // tslint:disable-next-line: no-any
        if (promise && (promise as any).then){
            await promise;
        }
    }
    private onCommTargetRegistered(targetName: string, callback: CommTargetCallback) {
        // this.sendMessage(InteractiveWindowMessages.IPyWidgets_registerCommTarget, targetName);
        this.messagesToSend.push(targetName);
        this.commTargetCallbacks.set(targetName, callback);
    }
    private sendMessage<M extends IInteractiveWindowMapping, T extends keyof M>(type: T, payload?: M[T]) {
        this.postOffice.sendMessage(type, payload);
    }

    /**
     * Create a `IComm` class that ipywidgets will use to communicate with the kernel.
     * Here we create a bogus (proxy) class. While the actual implementation is at the extension end.
     * Bascally this is a proxy, when `send` is invoked we send messages from the extension.
     * Similarly when messages arrive at the extension end, we propagate them through to the UI and
     * handl them here and invoke the corresponding delegates, such as `onMsg`.
     *
     * @private
     * @param {KernelMessage.ICommOpenMsg} msg
     * @returns {Kernel.IComm}
     * @memberof WidgetManager
     */
    private createKernelCommForCommOpenCallback(msg: KernelMessage.ICommOpenMsg): Kernel.IComm {
        const comm: Kernel.IComm = {
            ...msg.content,
            commId: msg.content.comm_id,
            targetName: msg.content.target_name,
            dispose: noop,
            // tslint:disable-next-line: no-any
            close: noop as any,
            // tslint:disable-next-line: no-any
            open: noop as any,
            // tslint:disable-next-line: no-any
            send: noop as any,
            onMsg: noop,
            isDisposed: false,
            onClose: noop
        };
        // This `send` method is used by widgets to send messages to the kernel (e.g. kernel links).
        // tslint:disable-next-line: no-any
        comm.send = (data: any, metadata?: any, _buffers?: any[], _disposeOnDone?: boolean) => {
            console.log('Sending');
            const requestId = uuid();
            const commId: string = msg.content.comm_id;
            const deferred = createDeferred<KernelMessage.IShellMessage | undefined>();
            // Create a dummy response (IFuture) that we'll send to ipywidgets controls.
            // Dummy because the actual IFuture object will be on the extension side.
            // tslint:disable-next-line: no-any
            const shellMessage = ({ header: { msg_id: requestId } } as any) as KernelMessage.IShellMessage;
            const reply: Partial<Kernel.IFuture> = {
                onIOPub: noop,
                onReply: noop,
                onStdin: noop,
                done: deferred.promise,
                msg: shellMessage
            };
            // tslint:disable-next-line: no-any
            const future = (reply as any) as Kernel.IFuture;
            // Keep track of the future.
            // When messages arrive from extension we can resolve this future.
            this.requestFutureMap.set(requestId, { future, deferred });

            // Send this payload to the extension where we'll use the real comms to send to the kernel.
            // The response will be handled and sent back as messages to the UI as messages `shellSend_*`
            this.sendMessage(InteractiveWindowMessages.IPyWidgets_ShellSend, { data, metadata, commId, requestId });

            // ipywidgets will use this as a promise (ifuture).
            return future;
        };

        return comm;
    }
}
