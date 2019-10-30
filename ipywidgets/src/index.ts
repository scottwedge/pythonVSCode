// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

export { WidgetManager } from './manager';
// import { WidgetManager } from './manager';
// tslint:disable-next-line: no-any
// (window as any).WidgetManager = WidgetManager;
// import { Kernel, KernelMessage } from '@jupyterlab/services';

// // tslint:disable: no-any no-console
// export function initialize(_kernel: Kernel.IKernel): { dispose: Function } {
//     console.error('Initialized');
//     return { dispose: () => console.log('ipywidgets disposed using dispose method') };
// }
// export function dispose() {
//     console.error('Disposed');
// }

// /**
//  * Displays a widget for the mesasge with header.msg_type === 'display_data'.
//  * The widget is rendered in the provided HTML element.
//  *
//  * @export
//  * @param {KernelMessage.IIOPubMessage} displayMessage
//  * @param {HTMLElement} _ele
//  * @returns {{ dispose: Function }}
//  */
// export function renderWidget(_displayMessage: KernelMessage.IIOPubMessage, _ele: HTMLElement): { dispose: Function } {
//     return { dispose: () => console.log('Widget disposd using dispose method') };
// }
// export function clearAll() {
//     console.error('clear all widgets');
// }
// document.addEventListener('DOMContentLoaded', () => {
//     // Connect to the notebook webserver.
//     //   let connectionInfo = ServerConnection.makeSettings({
//     //     baseUrl: BASEURL,
//     //     wsUrl: WSURL
//     //   });
//     if (!(document as any).Kernel) {
//         console.log('Started now getting out of here');
//         return;
//     }
//     console.log('Oops');
//     try {
//         const kernel: Kernel.IKernel = (document as any).getKernel();
//         const widgetarea = document.getElementsByClassName('widgetarea')[0] as HTMLElement;
//         console.log(widgetarea ? 'has widget area' : 'no widget area');
//         const manager = new WidgetManager(kernel, widgetarea);
//         console.log('Created widget manager');

//         (document as any).onIOPub = async (msg: KernelMessage.IIOPubMessage) => {
//             console.log('Got iopub message');

//             // If we have a display message, display the widget.
//             if (KernelMessage.isDisplayDataMsg(msg)) {
//                 console.log('Yes is display message');
//                 debugger;
//                 const widgetData: any = msg.content.data['application/vnd.jupyter.widget-view+json'];
//                 if (widgetData !== undefined && widgetData.version_major === 2) {
//                     const modelPromise = manager.get_model(widgetData.model_id);
//                     if (modelPromise !== undefined) {
//                         try {
//                             const model = await modelPromise;
//                             const view = await manager.create_view(model, {});
//                             await manager.display_view(msg, view, {});
//                         } catch (ex) {
//                             // return manager.display_model(msg, model);
//                             console.error(`Failed to display the model ${widgetData.model_id}`);
//                         }
//                     }
//                 }
//             }
//         };
//         console.log('Initialized');
//     } catch (ex) {
//         console.error('Error in ipywidget', ex);
//     }
// });
