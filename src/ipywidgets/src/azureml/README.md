This directory contains a copy of the azureml widget extension for jupyter's JS files as of 3/26/2020

Longer term we're trying to get the AML team to put this source on http://unpkg instead so we can load it dynamically

The top level of `index.js` is a requirejs definition, hence we modify the entry to contain a name, i.e. the name of the AML Widget `'azureml_widgets'`.
Old code in index.js is:
`define(["@jupyter-widgets/base"],(function(t){................}))`,
The new code is
`define('azureml_widgets', ["@jupyter-widgets/base"],(function(t){................}))`

I.e. just give the module a name instead of being anonymous.
