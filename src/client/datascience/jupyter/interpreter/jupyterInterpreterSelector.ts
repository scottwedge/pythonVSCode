// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { QuickPickOptions } from 'vscode';
import { IApplicationShell, IWorkspaceService } from '../../../common/application/types';
import { IConfigurationService, IPathUtils } from '../../../common/types';
import { DataScience } from '../../../common/utils/localize';
import { IInterpreterSelector } from '../../../interpreter/configuration/types';
import { PythonInterpreter } from '../../../interpreter/contracts';

/**
 * Displays interpreter select and returns the selection to the user.
 *
 * @export
 * @class JupyterInterpreterSelector
 */
@injectable()
export class JupyterInterpreterSelector {
    constructor(
        @inject(IInterpreterSelector) private readonly interpreterSelector: IInterpreterSelector,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IPathUtils) private readonly pathUtils: IPathUtils
    ) {}
    /**
     * Displays interpreter selector and returns the selection.
     *
     * @returns {(Promise<PythonInterpreter | undefined>)}
     * @memberof JupyterInterpreterSelector
     */
    public async selectInterpreter(): Promise<PythonInterpreter | undefined> {
        const currentJupyterInterpreter = this.configService.getSettings(undefined).datascience.jupyterInterpreter;
        const workspace = this.workspace.getWorkspaceFolder(undefined);
        const currentPythonPath = currentJupyterInterpreter ? this.pathUtils.getDisplayName(currentJupyterInterpreter, workspace?.uri.fsPath) : undefined;

        const suggestions = await this.interpreterSelector.getSuggestions(undefined);
        const quickPickOptions: QuickPickOptions = {
            matchOnDetail: true,
            matchOnDescription: true,
            placeHolder: currentPythonPath ? DataScience.currentlySelectedJupyterInterpreterForPlaceholder().format(currentPythonPath) : ''
        };

        const selection = await this.applicationShell.showQuickPick(suggestions, quickPickOptions);
        if (!selection) {
            return;
        }
        return selection.interpreter;
    }
}
