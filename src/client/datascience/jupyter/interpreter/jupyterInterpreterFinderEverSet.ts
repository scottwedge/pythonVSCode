// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject } from 'inversify';
import { Memento } from 'vscode';
import { GLOBAL_MEMENTO, IDisposable, IDisposableRegistry } from '../../../common/types';
import { noop } from '../../../common/utils/misc';

const key = 'INTERPRETER_SELECTED_FOR_JUPYTER_SERVER';
/**
 * Whether the user even selected an interpreter to be used as the gloabl jupyter interpreter.
 *
 * @export
 * @class JupyterInterpreterFinderEverSet
 */
export class JupyterInterpreterFinderEverSet {
    private _interpreterSetAtleastOnce: boolean = false;
    constructor(@inject(GLOBAL_MEMENTO) private readonly momento: Memento) {}

    /**
     * Whether the user set an interpreter at least once (an interpreter for starting of jupyter).
     *
     * @readonly
     * @type {Promise<boolean>}
     * @memberof JupyterInterpreterFinderEverSet
     */
    public get interpreterSetAtleastOnce(): boolean {
        return this.isInterpreterSetAtleastOnce;
    }
    /**
     * Whether the user set an interpreter at least once (an interpreter for starting of jupyter).
     * Value cannot be initialized to `false` if currently `true`.
     *
     * @memberof JupyterInterpreterFinderEverSet
     */
    public set interpreterSetAtleastOnce(value: boolean) {
        if (!value && this.isInterpreterSetAtleastOnce) {
            throw new Error('Value cannot be unset');
        }
        this._interpreterSetAtleastOnce = true;
        this.momento.update(key, true).then(noop, noop);
    }

    private get isInterpreterSetAtleastOnce(): boolean {
        if (this._interpreterSetAtleastOnce) {
            return true;
        }
        return this.momento.get<boolean>(key, false);
    }
}
