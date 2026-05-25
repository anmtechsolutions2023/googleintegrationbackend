-- Table Creation 

-- TaxTypes table
create table if not exists TaxTypes
(
    Id varchar(50) not null,
    Name varchar(50) not null,
    Value varchar(50) not null,
    Active tinyint(1) not null,
    TenantId varchar(50) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (Name, TenantId)
);

-- UOM table
create table if not exists UOM
(
    Id VARCHAR(50) not null,
    UnitName VARCHAR(50) not null,
    IsPrimary tinyint(1),
    Active TINYINT(1),
    TenantId varchar(50) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (UnitName, TenantId)
);

-- CategoryDetail table

create table if not exists categorydetail
(
    Id VARCHAR(50) not null,
    Name varchar(50) not null,
    Active tinyint(1) not null,
    TenantId varchar(50) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (Name, TenantId)
);

-- TransactionTypeConfig table

create table if not exists transactiontypeconfig
(
    Id VARCHAR(50) not null,
    StartCounterNo varchar(50) not null,
    Prefix varchar(50) not null,
    Format varchar(100) not null,
    Active tinyint(1) not null,
    TenantId varchar(50) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (StartCounterNo, Prefix, Format, TenantId)
);

-- Organization Detail table
create table if not exists organizationdetail
(
    Id varchar(50) not null,
    Name varchar(100) not null,
    Active tinyint(1) not null,
    TenantId varchar(50) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (Name, TenantId)
);

-- UOMFactor table

create table if not exists uomfactor
(
    Id varchar(50) not null,
    PrimaryUOMId VARCHAR(50) not null,
    SecondaryUOMId VARCHAR(50) not null,
    Factor VARCHAR(50) not null,
    Active tinyint(1) not null,
    TenantId varchar(50) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    FOREIGN KEY (PrimaryUOMId) REFERENCES UOM(Id),
    FOREIGN KEY (SecondaryUOMId) REFERENCES UOM(Id),
    UNIQUE (PrimaryUOMId, SecondaryUOMId, Factor, TenantId)
);

-- TransactionType table

create table if not exists transactiontype
(
    Id varchar(50) not null,
    Name varchar(50) not null,
    TransactionTypeConfigId varchar(50) not null,
    Active tinyint(1) not null,
    TenantId varchar(50) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (Name, TenantId),
    FOREIGN KEY (TransactionTypeConfigId) REFERENCES transactiontypeconfig(Id)
);


-- AccountTypeBase table

create table if not exists accounttypebase
(
    Id varchar(50) not null,
    Name varchar(50) not null,
    Active tinyint(1) not null,
    TenantId varchar(50) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (Name, TenantId)
);

-- TransactionTypeStatus table

create table if not exists transactiontypestatus
(
    Id varchar(50) not null,
    Name varchar(50) not null,
    Active tinyint(1) not null,
    TenantId varchar(50) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (Name, TenantId)
);

-- ContactAddressType table

create table if not exists contactaddresstype
(
    Id varchar(50) not null,
    Name varchar(50) not null,
    Active tinyint(1) not null,
    TenantId varchar(50) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (Name, TenantId)
);

-- TaxGroup table

create table if not exists taxgroup
(
	Id varchar(50) not null,
    Name varchar(50) not null,
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (Name, TenantId)
);

 -- Tax Group Tax Type Mapper table
create table if not exists taxgrouptaxtypemapper
(
	Id varchar(50) not null,
    TaxGroupId varchar(50) not null,
    TaxTypeId varchar(50) not null,
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (TaxGroupId, TaxTypeId, TenantId),
    FOREIGN KEY (TaxGroupId) REFERENCES taxgroup(Id),
    FOREIGN KEY (TaxTypeId) REFERENCES TaxTypes(Id)
);

-- Map Provider table

create table if not exists mapprovider
(
    Id varchar(50) not null,
    ProviderName varchar(50) not null,
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (ProviderName, TenantId)
);

-- Location Detail table

create table if not exists locationdetail
(
    Id varchar(50) not null,
    Lat varchar(50) not null,
    Lng varchar(50) not null,
    CF1 varchar(50),
    CF2 varchar(50),
    CF3 varchar(50),
    CF4 varchar(50),
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (Lat, Lng, TenantId)
);

-- Map Provider Location Mapper table
create table if not exists mapproviderlocationmapper
(
	Id varchar(50) not null,
    MapProviderId varchar(50) not null,
    LocationDetailId varchar(50) not null,
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (MapProviderId, LocationDetailId, TenantId),
    FOREIGN KEY (MapProviderId) REFERENCES mapprovider(Id),
    FOREIGN KEY (LocationDetailId) REFERENCES locationdetail(Id)
);

-- Contact Detail table
create table if not exists contactdetail
(
	Id varchar(50) not null,
    FirstName varchar(50) not null,
    LastName varchar(50) not null,
    MobileNo varchar(50),
    AltMobileNo varchar(50),
    Landline1 varchar(50),
    Landline2 varchar(50),
    Ext1 varchar(50),
    Ext2 varchar(50),
    ContactAddressTypeId varchar(50) not null,
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (FirstName, LastName, ContactAddressTypeId, TenantId),
    FOREIGN KEY (ContactAddressTypeId) REFERENCES contactaddresstype(Id)
);

-- Address Detail table
create table if not exists addressdetail
(
	Id varchar(50) not null,
    AddressLine1 varchar(50),
    AddressLine2 varchar(50),
    City varchar(50),
    State varchar(50),
    Pincode varchar(50),
    MapProviderLocationMapperId varchar(50) not null,
    Landmark varchar(50),
    ContactAddressTypeId varchar(50) not null,
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (AddressLine1, City, ContactAddressTypeId, TenantId),
    FOREIGN KEY (ContactAddressTypeId) REFERENCES contactaddresstype(Id),
    FOREIGN KEY (MapProviderLocationMapperId) REFERENCES mapproviderlocationmapper(Id)
);

-- Cost Info table
create table if not exists costinfo
(
	Id varchar(50) not null,
    Amount varchar(50) not null,
    TaxGroupId varchar(50) not null,
    IsTaxIncluded tinyint(1) not null,
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (Id, TenantId),
    FOREIGN KEY (TaxGroupId) REFERENCES taxgroup(Id)
);


-- Branch Detail table
create table if not exists branchdetail
(
	Id varchar(50) not null,
    OrganizationDetailId varchar(50) not null,
    ContactDetailId varchar(50) not null,
    AddressDetailId varchar(50) not null,
    TransactionTypeConfigId varchar(50) not null,
    BranchName varchar(50) not null,
	TINNo varchar(50),
    GSTIN varchar(50),
    PAN varchar(50),
    CF1 varchar(50),
    CF2 varchar(50),
    CF3 varchar(50),
    CF4 varchar(50),
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (OrganizationDetailId, BranchName, TenantId),
    FOREIGN KEY (OrganizationDetailId) REFERENCES organizationdetail(Id),
    FOREIGN KEY (ContactDetailId) REFERENCES contactdetail(Id),
    FOREIGN KEY (AddressDetailId) REFERENCES addressdetail(Id),
    FOREIGN KEY (TransactionTypeConfigId) REFERENCES transactiontypeconfig(Id)
);

 -- Branch  Group Mapper table
create table if not exists branchusergroupmapper
(
	Id varchar(50) not null,
    BranchDetailId varchar(50) not null,
    UserGroupId varchar(50) not null,
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (BranchDetailId, UserGroupId, TenantId),
    FOREIGN KEY (BranchDetailId) REFERENCES branchdetail(Id)
);

-- Batch Detail table
create table if not exists batchdetail
(
	Id varchar(50) not null,
    BatchNo varchar(50) not null,
    Barcode varchar(50) not null,
    MfgDate datetime not null,
    Expdate datetime not null,
    PurchaseDate datetime not null,
    IsNonReturnable tinyint(1) not null,
    CostInfoId varchar(50) not null,
    UOMId varchar(50) not null,
    Quantity varchar(50) not null,
    MapProviderLocationMapperId varchar(50) not null,
    BranchDetailId varchar(50) not null,    
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (BatchNo, BranchDetailId, TenantId),
    FOREIGN KEY (CostInfoId) REFERENCES costinfo(Id),
    FOREIGN KEY (UOMId) REFERENCES UOM(Id),
    FOREIGN KEY (MapProviderLocationMapperId) REFERENCES mapproviderlocationmapper(Id),
    FOREIGN KEY (BranchDetailId) REFERENCES branchdetail(Id)
);

-- Item Detail table
create table if not exists itemdetail (
	Id varchar(50) not null,
    Type varchar(50) not null,
    HSNCode varchar(50),
    SKU varchar(50),    
    BatchDetailId varchar(50) not null,
    CategoryId varchar(50) not null,
    Description varchar(50),    
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (Type, TenantId),
    FOREIGN KEY (BatchDetailId) REFERENCES batchdetail(Id),
    FOREIGN KEY (CategoryId) REFERENCES categorydetail(Id)
);

-- Transaction Type Base Conversion  table
create table if not exists transactiontypebaseconversion (
	Id varchar(50) not null,   
    FromTransactionTypeId varchar(50) not null,
    ToTransactionTypeId varchar(50) not null,
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),
    UNIQUE (FromTransactionTypeId, ToTransactionTypeId, TenantId),
    FOREIGN KEY (FromTransactionTypeId) REFERENCES transactiontype(Id),
    FOREIGN KEY (ToTransactionTypeId) REFERENCES transactiontype(Id)
);

-- Transaction Detail log table
create table if not exists transactiondetaillog
(
	Id varchar(50) not null,    
    AccountTypeBaseId varchar(50) not null,
    UserId varchar(50) not null,
    TransactionDateTime varchar(50) not null,
    Description varchar(100),
    BranchDetailId varchar(50) not null,
	CF1 varchar(50),
    CF2 varchar(50),
    CF3 varchar(50),
    CF4 varchar(50),      
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),    
    FOREIGN KEY (AccountTypeBaseId) REFERENCES accounttypebase(Id),
    FOREIGN KEY (BranchDetailId) REFERENCES branchdetail(Id)
);

-- Transaction Item Detail table
create table if not exists transactionitemdetail
  (
	Id varchar(50) not null,    
    TransactionDetailLogId varchar(50) not null,
    ItemId varchar(50) not null,
    Comment varchar(100),
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),    
    UNIQUE (TransactionDetailLogId, ItemId, TenantId),
    FOREIGN KEY (TransactionDetailLogId) REFERENCES transactiondetaillog(Id),
    FOREIGN KEY (ItemId) REFERENCES itemdetail(Id)
  );

-- Transaction Type Conversion Mapper table
create table if not exists transactiontypeconversionmapper 
(
	Id varchar(50) not null,    
    TransactionTypeBaseCoversionId varchar(50) not null,
    TransactionDetailLogId varchar(50) not null,
    TransactionTypeStatusId varchar(50) not null,
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),    
    UNIQUE (TransactionTypeBaseCoversionId, TransactionDetailLogId, TransactionTypeStatusId, TenantId),
    FOREIGN KEY (TransactionTypeBaseCoversionId) REFERENCES transactiontypebaseconversion(Id),
    FOREIGN KEY (TransactionDetailLogId) REFERENCES transactiondetaillog(Id),
    FOREIGN KEY (TransactionTypeStatusId) REFERENCES transactiontypestatus(Id)
);

-- Payment Received Type table
create table if not exists paymentreceivedtype 
(
	Id varchar(50) not null,    
    Type varchar(50) not null,
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),    
    UNIQUE (Type, TenantId)
);

-- Payment mode table
create table if not exists paymentmode 
(
	Id varchar(50) not null,    
    Type varchar(50) not null,
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),    
    UNIQUE (Type, TenantId)
);

-- Payment Mode Transaction Detail table
create table if not exists paymentmodetransactiondetail
(
	Id varchar(50) not null,    
    PaymentModeId varchar(50) not null,
    RefNo varchar(50),
    Comment varchar(100),
	CF1 varchar(50),
    CF2 varchar(50),
    CF3 varchar(50),
    CF4 varchar(50),      
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),    
    FOREIGN KEY (PaymentModeId) REFERENCES paymentmode(Id)
);

-- Payment Detail table
create table if not exists paymentdetail 
(
	Id varchar(50) not null,    
    AccountTypeBaseId varchar(50) not null,
    TransactionDetailLogId varchar(50) not null,
    DiscountAmount varchar(100),
	RoundOff varchar(50),
    TotalAmount varchar(50) not null,
    TaxesAmount varchar(50),
    GrossAmount varchar(50) not null,    
    UserId varchar(50) not null,    
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),    
    FOREIGN KEY (AccountTypeBaseId) REFERENCES accounttypebase(Id),
    FOREIGN KEY (TransactionDetailLogId) REFERENCES transactiondetaillog(Id)
);

-- Payment Breakup table
create table if not exists paymentbreakup
(
	Id varchar(50) not null,    
    AccountTypeBaseId varchar(50) not null,
    PaymentDetailId varchar(50) not null,
    PaymentModeTransactionDetailId varchar(100) not null,
	PaymentReceivedTypeId varchar(50) not null,
    UserId varchar(50) not null,    
    Timestamp datetime not null,    
    TenantId varchar(50) not null,
    Active tinyint(1) not null,
    CreatedOn datetime,
    CreatedBy varchar(50),
    UpdatedOn datetime,
    UpdatedBy varchar(50),
    PRIMARY KEY (Id),    
    FOREIGN KEY (AccountTypeBaseId) REFERENCES accounttypebase(Id),
    FOREIGN KEY (PaymentDetailId) REFERENCES paymentdetail(Id),
    FOREIGN KEY (PaymentModeTransactionDetailId) REFERENCES paymentmodetransactiondetail(Id),
    FOREIGN KEY (PaymentReceivedTypeId) REFERENCES paymentreceivedtype(Id)
);