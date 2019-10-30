// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { Kernel } from '@jupyterlab/services';
import { noop } from '../../client/common/utils/misc';
import { CommTargetCallback } from './types';

type CommTargetRegisteredHandler = (targetName: string, callback: CommTargetCallback) => void;

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
    private readonly handlers: CommTargetRegisteredHandler[] = [];
    /**
     * This method is used by ipywidgets manager.
     *
     * @param {string} targetName
     * @param {CommTargetCallback} callback
     * @memberof ProxyKernel
     */
    public registerCommTarget(targetName: string, callback: CommTargetCallback): void {
        this.handlers.forEach(handler => handler(targetName, callback));
    }
    public dispose() {
        while (this.handlers.shift()) {
            noop();
        }
    }
    public on(_event: 'commTargetRegistered', callback: CommTargetRegisteredHandler) {
        this.handlers.push(callback);
    }

    public removeListener(_event: 'commTargetRegistered', callback: CommTargetRegisteredHandler) {
        const index = this.handlers.indexOf(callback);
        if (index > -1) {
            this.handlers.splice(index, 1);
        }
    }
}
