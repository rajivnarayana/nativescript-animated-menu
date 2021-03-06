var dependencyObservable = require( "ui/core/dependency-observable" );
var proxy = require( "ui/core/proxy" );
var absoluteLayoutModule = require("ui/layouts/absolute-layout");

var merge = require("utils/module-merge");
var frameModule = require("ui/frame/frame");

var view = require("ui/core/view");
var pages = require("ui/page");
var types = require("utils/types");
var trace = require("trace");
var builder = require("ui/builder");
var fs = require("file-system");
var utils = require("utils/utils");
var platform = require("platform");
var fileResolverModule = require("file-system/file-name-resolver");


var mainView = null;
var menuView = null;

var menuOpen = false;
var origMainTransform = {};
var origMenuTransform = {};



function AniMenu() {}

AniMenu.prototype = new absoluteLayoutModule.AbsoluteLayout();

AniMenu.prototype.setupViews = function() {

    //main view
    var mainEntry = buildEntryFromArgs(this.main);
    var mainPage = resolvePageFromEntry(mainEntry);
    var mainContent = mainPage.content;
    
    mainView = mainContent._view;
    merge.merge(mainView.transform, origMainTransform);
    mainPage._removeView(mainContent);

    
    //menu view
    var menuEntry = buildEntryFromArgs(this.menu);
    var menuPage = resolvePageFromEntry(menuEntry);
    var menuContent = menuPage.content;
    
    menuView = menuContent._view;
    merge.merge(menuView.transform, origMenuTransform);
    menuPage._removeView(menuContent);

    
    var deviceFrame = UIScreen.mainScreen().bounds;
    var size = deviceFrame.size;
    var width = size.width;
    var height = size.height;

    global.mainContent = mainContent;
    mainContent.height = height;
    mainContent.width = width;
   
    this.addChild(menuContent);
    this.addChild(mainContent);
    
    openMenu(closeMenu);
}

AniMenu.prototype.checkViews = function() {
	if ( !this.main || !this.menu ) {
		return;
	}
    this.setupViews();
}

var properties = [ "main", "menu" ];
properties.forEach(function( name ) {
	var property = new dependencyObservable.Property(
		name,        // Name of the attribute
		"id" + name, // id? Still not sure what this is
		new dependencyObservable.PropertyMetadata(
			0,       // default value of the attribute
			dependencyObservable.PropertyMetadataSettings.None,
			function( data ) {
				data.object.checkViews();
			}
		)
	);
	exports[ name + "Property" ] = property;

	Object.defineProperty( AniMenu.prototype, name, {
		get: function() {
			return this._getValue( property );
		},
		set: function( value ) {
            this._setValue( property, value );
		}
	});
});

exports.AniMenu = AniMenu;


function menuTriggerAction(args) {
    var eventName = args.eventName;
    var btn = args.object;
   
    var transformObj = {};
    merge.merge(origMainTransform, transformObj);
    
    if (!menuOpen) {
        transformObj.a = origMainTransform.a * 0.6;
        transformObj.d = origMainTransform.d * 0.6;
        transformObj.tx = mainView.bounds.size.width * 0.5;
        transformObj.ty = mainView.bounds.size.height * 0.1;
        openMenu();
    }
    else {
        closeMenu();
    }
    
    function mainAnimations() {
        mainView.transform = transformObj;
    }
    
    function animationComplete(finished) {}
    
    UIView.animateWithDurationDelayOptionsAnimationsCompletion(
        0.3,
        0.0,
        [UIViewAnimationCurveEaseIn],
        mainAnimations,
        animationComplete
    );
    
    menuOpen = !menuOpen;
}

exports.menuTriggerAction = menuTriggerAction;


function openMenu(callback) {
    var transformObj = {};
    merge.merge(origMenuTransform, transformObj);
    
    transformObj.a = 1;
    transformObj.d = 1;
    transformObj.tx = 0;
    transformObj.ty = 0;
    
    function animations() {
        menuView.transform = transformObj;
    }
    
    function animationComplete(finished) {
        if (!types.isNullOrUndefined(callback))
            callback();
    }
    
    UIView.animateWithDurationDelayOptionsAnimationsCompletion(
        0.3,
        0.0,
        UIViewAnimationOptionCurveEaseOut,
        animations,
        animationComplete
    );
}

function closeMenu(callback) {
    var transformObj = {};
    merge.merge(origMenuTransform, transformObj);
    
    transformObj.a = origMenuTransform.a * 1.6;
    transformObj.d = origMenuTransform.d * 1.6;
    transformObj.tx = UIScreen.mainScreen().bounds.size.width * 0.2;
    transformObj.ty = UIScreen.mainScreen().bounds.size.height * 0.2;
    
    function animations() {
        menuView.transform = transformObj;
    }
    
    function animationComplete(finished) {
        if (!types.isNullOrUndefined(callback))
            callback();
    }
    
    UIView.animateWithDurationDelayOptionsAnimationsCompletion(
        0.3,
        0.0,
        UIViewAnimationOptionCurveEaseOut,
        animations,
        animationComplete
    );
}



function buildEntryFromArgs(arg) {
    var entry;
    if (arg instanceof pages.Page) {
        throw new Error("Navigating to a Page instance is no longer supported. Please navigate by using either a module name or a page factory function.");
    }
    else if (types.isString(arg)) {
        entry = {
            moduleName: arg
        };
    }
    else if (types.isFunction(arg)) {
        entry = {
            create: arg
        };
    }
    else {
        entry = arg;
    }
    return entry;
}

function resolvePageFromEntry(entry) {
    var page;
    if (entry.create) {
        page = entry.create();
        if (!(page && page instanceof pages.Page)) {
            throw new Error("Failed to create Page with entry.create() function.");
        }
    }
    else if (entry.moduleName) {
        var currentAppPath = fs.knownFolders.currentApp().path;
        var moduleNamePath = fs.path.join(currentAppPath, entry.moduleName);
        var moduleExports;
        var moduleExportsResolvedPath = resolveFilePath(moduleNamePath, "js");
        if (moduleExportsResolvedPath) {
            trace.write("Loading JS file: " + moduleExportsResolvedPath, trace.categories.Navigation);
            moduleExportsResolvedPath = moduleExportsResolvedPath.substr(0, moduleExportsResolvedPath.length - 3);
            moduleExports = require(moduleExportsResolvedPath);
        }
        if (moduleExports && moduleExports.createPage) {
            trace.write("Calling createPage()", trace.categories.Navigation);
            page = moduleExports.createPage();
        }
        else {
            page = pageFromBuilder(moduleNamePath, moduleExports);
        }
        if (!(page && page instanceof pages.Page)) {
            throw new Error("Failed to load Page from entry.moduleName: " + entry.moduleName);
        }
    }
    return page;
}

var fileNameResolver;
function resolveFilePath(path, ext) {
    if (!fileNameResolver) {
        fileNameResolver = new fileResolverModule.FileNameResolver({
            width: platform.screen.mainScreen.widthDIPs,
            height: platform.screen.mainScreen.heightDIPs,
            os: platform.device.os,
            deviceType: platform.device.deviceType
        });
    }
    return fileNameResolver.resolveFileName(path, ext);
}
function pageFromBuilder(moduleNamePath, moduleExports) {
    var page;
    var element;
    var fileName = resolveFilePath(moduleNamePath, "xml");
    if (fileName) {
        trace.write("Loading XML file: " + fileName, trace.categories.Navigation);
        element = builder.load(fileName, moduleExports);
        if (element instanceof pages.Page) {
            page = element;
            var cssFileName = resolveFilePath(moduleNamePath, "css");
            if (cssFileName) {
                page.addCssFile(cssFileName);
            }
        }
    }
    return page;
}