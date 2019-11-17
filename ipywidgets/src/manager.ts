// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { DOMWidgetView, shims } from '@jupyter-widgets/base';
import { HTMLManager } from '@jupyter-widgets/html-manager';
import { Kernel } from '@jupyterlab/services';
import * as pWidget from '@phosphor/widgets';
// import './widgets.less';

// Source borrowed from https://github.com/jupyter-widgets/ipywidgets/blob/master/examples/web3/src/manager.ts
// tslint:disable: no-any no-console

const cdn = 'https://unpkg.com/';

function moduleNameToCDNUrl(moduleName: string, moduleVersion: string) {
    let packageName = moduleName;
    let fileName = 'index'; // default filename
    // if a '/' is present, like 'foo/bar', packageName is changed to 'foo', and path to 'bar'
    // We first find the first '/'
    let index = moduleName.indexOf('/');
    if (index !== -1 && moduleName[0] === '@') {
        // if we have a namespace, it's a different story
        // @foo/bar/baz should translate to @foo/bar and baz
        // so we find the 2nd '/'
        index = moduleName.indexOf('/', index + 1);
    }
    if (index !== -1) {
        fileName = moduleName.substr(index + 1);
        packageName = moduleName.substr(0, index);
    }
    return `${cdn}${packageName}@${moduleVersion}/dist/${fileName}`;
}

async function requirePromise(pkg: string | string[]): Promise<any> {
    return new Promise((resolve, reject) => {
        const requirejs = (window as any).requirejs;
        if (requirejs === undefined) {
            reject('Requirejs is needed, please ensure it is loaded on the page.');
        } else {
            requirejs(pkg, resolve, reject);
        }
    });
}

function requireLoader(moduleName: string, moduleVersion: string) {
    const requirejs = (window as any).requirejs;
    if (requirejs === undefined) {
        throw new Error('Requirejs is needed, please ensure it is loaded on the page.');
    }
    const conf: { paths: { [key: string]: string } } = { paths: {} };
    conf.paths[moduleName] = moduleNameToCDNUrl(moduleName, moduleVersion);
    requirejs.config(conf);

    return requirePromise([`${moduleName}`]);
}

export class WidgetManager extends HTMLManager {
    public kernel: Kernel.IKernelConnection;
    public el: HTMLElement;
    constructor(kernel: Kernel.IKernelConnection, el: HTMLElement) {
        super({ loader: requireLoader });
        debugger;
        this.kernel = kernel;
        this.el = el;

        kernel.registerCommTarget(this.comm_target_name, async (comm, msg) => {
            const oldComm = new shims.services.Comm(comm);
            return this.handle_comm_open(oldComm, msg) as Promise<any>;
        });
    }

    public display_view(view: DOMWidgetView, options: { el: HTMLElement }) {
        return Promise.resolve(view).then(vw => {
            pWidget.Widget.attach(view.pWidget, options.el);
            vw.on('remove', () => {
                console.log('view removed', vw);
            });
            return vw;
        });
    }

    /**
     * Create a comm.
     */
    public async _create_comm(target_name: string, model_id: string, data?: any, metadata?: any): Promise<shims.services.Comm> {
        const comm = this.kernel.connectToComm(target_name, model_id);
        if (data || metadata) {
            comm.open(data, metadata);
        }
        return Promise.resolve(new shims.services.Comm(comm));
    }

    /**
     * Get the currently-registered comms.
     */
    public _get_comm_info(): Promise<any> {
        return this.kernel.requestCommInfo({ target: this.comm_target_name }).then(reply => (reply.content as any).comms);
    }
    protected loadClass(className: string, moduleName: string, moduleVersion: string): Promise<any> {
        return super.loadClass(className, moduleName, moduleVersion).catch(() => requireLoader(moduleName, moduleVersion));
    }
}
