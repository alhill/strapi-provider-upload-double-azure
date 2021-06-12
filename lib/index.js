const {
    Aborter,
    BlobURL,
    BlockBlobURL,
    ContainerURL,
    ServiceURL,
    StorageURL,
    SharedKeyCredential,
    uploadStreamToBlockBlob,
} = require('@azure/storage-blob');
const BufferStream = require('./BufferStream');
const trimParam = str => (typeof str === 'string' ? str.trim() : undefined);

module.exports = {
    provider: 'azure',
    auth: {
        account: {
            label: 'Account name',
            type: 'text',
        },
        accountKey: {
            label: 'Secret Access Key',
            type: 'text',
        },
        serviceBaseURL: {
            label: 'Base service URL to be used, optional. Defaults to https://${account}.blob.core.windows.net',
            type: 'text',
        },
        containerNamePublic: {
            label: 'Container name of the public content',
            type: 'text',
        },
        containerNamePrivate: {
            label: 'Container name of the private content',
            type: 'text',
        },
        defaultPathPublic: {
            label: 'The path to use inside the public container',
            type: 'text',
        },
        defaultPathPrivate: {
            label: 'The path to use inside the private container',
            type: 'text',
        },
        cdnRoot: {
            label: "The path to substitute the root of the public container",
            type: "text"
        },
        maxConcurent: {
            label: 'The maximum concurrent uploads to Azure',
            type: 'number'
        },
    },
    init: config => {

        const account = trimParam(config.account);
        const accountKey = trimParam(config.accountKey);
        const sharedKeyCredential = new SharedKeyCredential(account, accountKey);
        const pipeline = StorageURL.newPipeline(sharedKeyCredential);
        const serviceBaseURL = trimParam(config.serviceBaseURL) || `https://${account}.blob.core.windows.net`
        const serviceURL = new ServiceURL(serviceBaseURL, pipeline);
        const containerURLPublic = ContainerURL.fromServiceURL(serviceURL, config.containerNamePublic);
        const containerURLPrivate = ContainerURL.fromServiceURL(serviceURL, config.containerNamePrivate);

        return {
            upload: async file => {
                const private = file.private
                const azureRes = new Promise((resolve, reject) => {
                    const fileName = file.hash + file.ext;
                    const containerWithPath = Object.assign({}, private ? containerURLPrivate : containerURLPublic);
                    const defaultPath = private ? config.defaultPathPrivate : config.defaultPathPublic
                    containerWithPath.url += file.path ? `/${file.path}` : `/${defaultPath}`;
                    const blobURL = BlobURL.fromContainerURL(containerWithPath, fileName);
                    const blockBlobURL = BlockBlobURL.fromBlobURL(blobURL);

                    if(private){
                        file.url = blobURL.url
                    } else {
                        file.bucketUrl = blobURL.url
                        file.url = blobURL.url.replace(containerWithPath.url, config.cdnRoot)
                    }

                    return uploadStreamToBlockBlob(
                        Aborter.timeout(60 * 60 * 1000),
                        new BufferStream(file.buffer), blockBlobURL,
                        4 * 1024 * 1024,
                        ~~(config.maxConcurent) || 20,
                        {
                            blobHTTPHeaders: {
                                blobContentType: file.mime
                            }
                        }
                    ).then(resolve, reject);
                })

                return azureRes
            },
            delete: async file => {
                const azureRes = new Promise((resolve, reject) => {
                    const url = file.bucketUrl || file.url
                    const private = url.includes(containerURLPrivate.url)
                    const containerURL = private ? containerURLPrivate : containerURLPublic
                    const _temp = url.replace(containerURL.url, '');
                    const pathParts = _temp.split('/').filter(x => x.length > 0);
                    const fileName = pathParts.splice(pathParts.length - 1, 1);
                    const containerWithPath = Object.assign({}, containerURL);
                    containerWithPath.url += '/' + pathParts.join('/');

                    const blobURL = BlobURL.fromContainerURL(containerWithPath, fileName);
                    const blockBlobURL = BlockBlobURL.fromBlobURL(blobURL);

                    return blockBlobURL.delete().then(resolve, err => reject(err));
                })
        
                return azureRes
            }
        };
    }
};
