// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { IApplicationShell } from '../../../common/application/types';
import { ProductNames } from '../../../common/installer/productNames';
import { IInstaller, InstallerResponse, Product } from '../../../common/types';
import { Common, DataScience } from '../../../common/utils/localize';
import { noop } from '../../../common/utils/misc';
import { PythonInterpreter } from '../../../interpreter/contracts';
import { JupyterInterpreterPicker } from './jupyterInterpreterPicker';

enum JupyterInstallationResponse {
    ok,
    selectAnotherInterpreter,
    cancel
}

@injectable()
export class JupyterInterpreterService {
    constructor(
        @inject(JupyterInterpreterPicker) private readonly picker: JupyterInterpreterPicker,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IInstaller) private readonly installer: IInstaller
    ) {}
    public async getSelectedInterpreter(): Promise<PythonInterpreter | undefined> {
        return;
    }
    public async selectInterpreter(): Promise<PythonInterpreter | undefined> {
        // tslint:disable-next-line: no-constant-condition
        while (true) {
            const interpreter = await this.picker.selectInterpreter(undefined);
            if (!interpreter) {
                return;
            }

            const result = await this.installMissingDependencies(interpreter);
            switch (result) {
                case JupyterInstallationResponse.ok:
                    return interpreter;
                case JupyterInstallationResponse.cancel:
                    return;
                default:
                    continue;
            }
        }
    }

    private async installMissingDependencies(interpreter: PythonInterpreter): Promise<JupyterInstallationResponse> {
        const productsToInstall = await this.dependenciesNotInstalled(interpreter);
        if (productsToInstall.length === 0) {
            return JupyterInstallationResponse.ok;
        }

        const names = productsToInstall
            .map(product => ProductNames.get(product))
            .filter(name => !!name)
            .map(name => name as string);
        const message = DataScience.libraryNotInstalled().format(names.join(' and '));

        const selection = await this.applicationShell.showErrorMessage(message, DataScience.jupyterInstall(), DataScience.selectDifferentJupyterInterpreter(), Common.cancel());

        switch (selection) {
            case DataScience.jupyterInstall(): {
                const productToInstall = productsToInstall.shift();
                while (productToInstall) {
                    const response = await this.installer.install(productToInstall, interpreter);
                    if (response === InstallerResponse.Installed) {
                        continue;
                    } else {
                        return JupyterInstallationResponse.ok;
                    }
                }

                return JupyterInstallationResponse.cancel;
            }

            case DataScience.selectDifferentJupyterInterpreter(): {
                return JupyterInstallationResponse.selectAnotherInterpreter;
            }

            default:
                return JupyterInstallationResponse.cancel;
        }
    }
    private async dependenciesNotInstalled(interpreter: PythonInterpreter): Promise<Product[]> {
        const notInstalled: Product[] = [];
        await Promise.all([
            this.installer.isInstalled(Product.jupyter, interpreter).then(installed => (installed ? noop() : notInstalled.push(Product.jupyter))),
            this.installer.isInstalled(Product.notebook, interpreter).then(installed => (installed ? noop() : notInstalled.push(Product.notebook)))
        ]);
        return notInstalled;
    }
}
