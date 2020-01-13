// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject } from 'inversify';
import { Memento } from 'vscode';
import { IExtensionSingleActivationService } from '../../../activation/types';
import { GLOBAL_MEMENTO, IConfigurationService } from '../../../common/types';
import { noop } from '../../../common/utils/misc';
import { JupyterInterpreterService } from './jupyterInterpreterService';

const key = 'INTERPRETER_SELECTED_FOR_JUPYTER_SERVER';
/**
 * Keeps track of whether the user ever selected an interpreter to be used as the gloabl jupyter interpreter.
 *
 * @export
 * @class JupyterInterpreterFinderEverSet
 */
export class JupyterInterpreterSelected implements IExtensionSingleActivationService {
    private _interpreterSetAtleastOnce: boolean = false;
    constructor(
        @inject(GLOBAL_MEMENTO) private readonly memento: Memento,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(JupyterInterpreterService) private readonly interpreterService: JupyterInterpreterService
    ) {}

    public async activate(): Promise<void> {
        // If user has manually setup an interpreter, then udpate the memento.
        if (!this.isInterpreterSetAtleastOnce && this.configService.getSettings(undefined).datascience.jupyterInterpreter) {
            this.updateSelectionState();
        }
        this.interpreterService.onDidChangeInterpreter(() => this.updateSelectionState());
    }

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
    private updateSelectionState() {
        this._interpreterSetAtleastOnce = true;
        this.memento.update(key, true).then(noop, noop);
    }

    private get isInterpreterSetAtleastOnce(): boolean {
        return this._interpreterSetAtleastOnce || this.memento.get<boolean>(key, false);
    }
}
